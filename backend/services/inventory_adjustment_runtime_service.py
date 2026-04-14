import json
from datetime import datetime
from typing import Any, Dict, Optional, Sequence

from sqlalchemy import and_, desc, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

import models
from services.audit_log_service import create_audit_log
from services.inventory_adjustment_email_service import (
    _extract_latest_email_segment,
    parse_inventory_adjustment_email_items,
    parse_inventory_adjustment_email_items_with_ai,
)
from services.inventory_reconciliation_cycle_service import (
    ensure_open_reconciliation_cycle,
    get_latest_reconciliation_cycle,
)


def _official_inventory_change_logs_query():
    return (
        select(models.InventoryChangeLog)
        .where(
            models.InventoryChangeLog.source != "inventory_adjustment_apply",
            models.InventoryChangeLog.is_deleted.is_(False),
        )
    )


async def _load_records_by_ids(
    db: AsyncSession,
    record_ids: Sequence[int],
) -> Dict[int, models.InventoryRecord]:
    unique_ids = sorted({int(record_id) for record_id in record_ids if int(record_id) > 0})
    if not unique_ids:
        return {}

    result = await db.execute(
        select(models.InventoryRecord).where(models.InventoryRecord.id.in_(unique_ids))
    )
    records = list(result.scalars().all())
    return {int(record.id): record for record in records}


async def list_official_inventory_records(
    db: AsyncSession,
    limit: int = 5,
) -> list[models.InventoryRecord]:
    logs_result = await db.execute(
        _official_inventory_change_logs_query()
        .order_by(desc(models.InventoryChangeLog.changed_at), desc(models.InventoryChangeLog.id))
        .limit(limit)
    )
    logs = list(logs_result.scalars().all())
    if logs:
        records_by_id = await _load_records_by_ids(db, [int(log.record_id) for log in logs])
        records: list[models.InventoryRecord] = []
        for log in logs:
            record = records_by_id.get(int(log.record_id))
            if record is not None:
                records.append(record)
        if records:
            return records

    fallback_result = await db.execute(
        select(models.InventoryRecord)
        .order_by(desc(models.InventoryRecord.parsed_at), desc(models.InventoryRecord.id))
        .limit(limit)
    )
    return list(fallback_result.scalars().all())


async def get_latest_official_inventory_record(
    db: AsyncSession,
) -> Optional[models.InventoryRecord]:
    records = await list_official_inventory_records(db=db, limit=1)
    return records[0] if records else None


async def _get_inventory_reconciliation_cycle(
    db: AsyncSession,
) -> tuple[models.InventoryRecord, models.InventoryRecord, bool, Optional[models.InventoryReconciliationCycle]]:
    records = await list_official_inventory_records(db=db, limit=2)
    if not records:
        raise ValueError("当前还没有基准库存表，请先导入一份库存表")

    # Priority 1: Locked cycle with both base and closing
    locked_cycle = await get_latest_reconciliation_cycle(db, status="locked")
    if locked_cycle is not None and locked_cycle.closing_record_id:
        record_map = await _load_records_by_ids(
            db,
            [int(locked_cycle.base_record_id), int(locked_cycle.closing_record_id)],
        )
        base_record = record_map.get(int(locked_cycle.base_record_id))
        latest_record = record_map.get(int(locked_cycle.closing_record_id))
        if base_record is not None and latest_record is not None:
            return base_record, latest_record, True, locked_cycle

    # Priority 2: Open cycle — check if it has a closing record for comparison
    open_cycle = await get_latest_reconciliation_cycle(db, status="open")
    if open_cycle is not None:
        if open_cycle.closing_record_id:
            # Open cycle has both base and closing → can compare!
            record_map = await _load_records_by_ids(
                db,
                [int(open_cycle.base_record_id), int(open_cycle.closing_record_id)],
            )
            base_record = record_map.get(int(open_cycle.base_record_id))
            closing_record = record_map.get(int(open_cycle.closing_record_id))
            if base_record is not None and closing_record is not None:
                return base_record, closing_record, False, open_cycle

        # Open cycle with base only — load the base record
        result = await db.execute(
            select(models.InventoryRecord).where(
                models.InventoryRecord.id == int(open_cycle.base_record_id)
            )
        )
        base_record = result.scalar_one_or_none()
        if base_record is not None:
            return base_record, base_record, False, open_cycle

    # Fallback: no cycle management, use latest record
    latest_record = records[0]
    open_cycle = await ensure_open_reconciliation_cycle(
        db,
        base_record=latest_record,
        actor="system",
        note=f"期初库存表：{latest_record.file_name or latest_record.source_email}",
    )
    return latest_record, latest_record, False, open_cycle


async def scan_inventory_adjustment_emails(
    db: AsyncSession,
    gmail_service: Any,
    limit: int = 500,
) -> Dict[str, Any]:
    latest_record = await get_latest_official_inventory_record(db)
    latest_payload = _load_inventory_payload(latest_record.raw_data if latest_record else None)
    active_cycle = None
    if latest_record is not None:
        active_cycle = await ensure_open_reconciliation_cycle(
            db,
            base_record=latest_record,
            actor="system",
            note=f"期初库存表：{latest_record.file_name or latest_record.source_email}",
        )

    messages = gmail_service.search_messages("newer_than:365d", max_results=limit)
    created_events = []
    skipped = 0

    for message in messages:
        msg_id = str(message.get("id") or "").strip()
        if not msg_id:
            skipped += 1
            continue

        detail = gmail_service.get_message_detail(msg_id)
        sender = gmail_service.get_message_sender(detail)
        subject = gmail_service.get_message_subject(detail)
        body_text = gmail_service.get_message_body_text(detail)
        latest_body = _extract_latest_email_segment(body_text)
        thread_id = gmail_service.get_message_thread_id(detail)

        parsed_items = parse_inventory_adjustment_email_items(
            sender=sender,
            subject=subject,
            body_text=body_text,
        )
        if not parsed_items:
            parsed_items = await parse_inventory_adjustment_email_items_with_ai(
                sender=sender,
                subject=subject,
                body_text=body_text,
            )
        if not parsed_items:
            skipped += 1
            continue

        for item_index, parsed in enumerate(parsed_items, start=1):
            synthetic_message_id = f"{msg_id}::{item_index}"
            existing = await db.execute(
                select(models.InventoryAdjustmentEvent.id)
                .where(models.InventoryAdjustmentEvent.gmail_message_id == synthetic_message_id)
                .limit(1)
            )
            if existing.scalar_one_or_none() is not None:
                skipped += 1
                continue

            match_count, matched_part_no, matched_part_name = _match_inventory_item(
                latest_payload=latest_payload,
                part_no=parsed.part_no,
                part_name=parsed.part_name,
            )

            event = models.InventoryAdjustmentEvent(
                gmail_message_id=synthetic_message_id,
                gmail_thread_id=thread_id or None,
                sender=sender or None,
                subject=subject or None,
                body_text=(latest_body or parsed.source_excerpt or body_text or None),
                cycle_id=int(active_cycle.id) if active_cycle is not None else None,
                match_count=match_count,
                matched_part_no=matched_part_no,
                matched_part_name=matched_part_name,
                **parsed.to_record_payload(),
            )
            db.add(event)
            await db.flush()

            created_events.append(
                {
                    "id": event.id,
                    "gmail_message_id": synthetic_message_id,
                    "source_message_id": msg_id,
                    "sender": sender,
                    "subject": subject,
                    "part_no": event.part_no,
                    "part_name": event.part_name,
                    "matched_part_no": matched_part_no,
                    "matched_part_name": matched_part_name,
                    "match_count": match_count,
                    "status": event.status,
                    "change_type": event.change_type,
                    "quantity": event.quantity,
                    "confidence": event.parse_confidence,
                    "parse_source": event.parse_source,
                }
            )

    await db.commit()

    return {
        "success": True,
        "created_count": len(created_events),
        "skipped_count": skipped,
        "events": created_events,
    }


async def get_inventory_adjustment_cycle_summary(
    db: AsyncSession,
) -> Dict[str, Any]:
    base_record, latest_record, cycle_closed, cycle = await _get_inventory_reconciliation_cycle(db)

    confirmed_events_query = (
        select(models.InventoryAdjustmentEvent)
        .where(
            models.InventoryAdjustmentEvent.status == "applied",
            models.InventoryAdjustmentEvent.applied_at.is_not(None),
        )
        .order_by(models.InventoryAdjustmentEvent.applied_at.asc(), models.InventoryAdjustmentEvent.id.asc())
    )
    if cycle is not None:
        legacy_confirmed_condition = and_(
            models.InventoryAdjustmentEvent.cycle_id.is_(None),
            models.InventoryAdjustmentEvent.applied_at >= base_record.parsed_at,
        )
        if cycle_closed and int(base_record.id) != int(latest_record.id):
            legacy_confirmed_condition = and_(
                legacy_confirmed_condition,
                models.InventoryAdjustmentEvent.applied_at <= latest_record.parsed_at,
            )
        confirmed_events_query = confirmed_events_query.where(
            or_(
                models.InventoryAdjustmentEvent.cycle_id == int(cycle.id),
                legacy_confirmed_condition,
            )
        )
    else:
        confirmed_events_query = confirmed_events_query.where(
            models.InventoryAdjustmentEvent.applied_at >= base_record.parsed_at
        )
        if cycle_closed and int(base_record.id) != int(latest_record.id):
            confirmed_events_query = confirmed_events_query.where(
                models.InventoryAdjustmentEvent.applied_at <= latest_record.parsed_at
            )
    applied_events_result = await db.execute(confirmed_events_query)
    applied_events = list(applied_events_result.scalars().all())

    pending_query = (
        select(models.InventoryAdjustmentEvent.id)
        .where(
            models.InventoryAdjustmentEvent.status == "pending",
        )
    )
    if cycle is not None:
        legacy_pending_condition = and_(
            models.InventoryAdjustmentEvent.cycle_id.is_(None),
            models.InventoryAdjustmentEvent.created_at >= base_record.parsed_at,
        )
        if cycle_closed and int(base_record.id) != int(latest_record.id):
            legacy_pending_condition = and_(
                legacy_pending_condition,
                models.InventoryAdjustmentEvent.created_at <= latest_record.parsed_at,
            )
        pending_query = pending_query.where(
            or_(
                models.InventoryAdjustmentEvent.cycle_id == int(cycle.id),
                legacy_pending_condition,
            )
        )
    else:
        pending_query = pending_query.where(
            models.InventoryAdjustmentEvent.created_at >= base_record.parsed_at
        )
        if cycle_closed and int(base_record.id) != int(latest_record.id):
            pending_query = pending_query.where(
                models.InventoryAdjustmentEvent.created_at <= latest_record.parsed_at
            )
    pending_count_result = await db.execute(pending_query)
    pending_event_count = len(list(pending_count_result.scalars().all()))

    base_payload = _load_inventory_payload(base_record.raw_data)
    latest_payload = _load_inventory_payload(latest_record.raw_data)

    row_map: Dict[str, Dict[str, Any]] = {}

    for event in applied_events:
        effective_part_no = str(event.matched_part_no or event.part_no or "").strip()
        if not effective_part_no:
            continue

        row = row_map.setdefault(
            effective_part_no,
            {
                "part_no": effective_part_no,
                "part_name": (
                    event.matched_part_name
                    or event.part_name
                    or _find_row_description(base_payload.get("inventory_rows") or [], effective_part_no)
                    or _find_row_description(latest_payload.get("inventory_rows") or [], effective_part_no)
                ),
                "base_quantity": _get_inventory_quantity_or_zero(base_payload, effective_part_no),
                "outbound_total": 0.0,
                "inbound_total": 0.0,
                "return_total": 0.0,
                "scrap_total": 0.0,
                "event_count": 0,
            },
        )

        delta = float(event.quantity or 0)
        if event.change_type == "outbound":
            row["outbound_total"] += delta
        elif event.change_type == "inbound":
            row["inbound_total"] += delta
        elif event.change_type == "return":
            row["return_total"] += delta
        elif event.change_type == "scrap":
            row["scrap_total"] += delta

        row["event_count"] += 1

    base_items = base_payload.get("items") or {}
    latest_items = latest_payload.get("items") or {}
    all_part_nos = {
        str(part_no).strip()
        for part_no in [*base_items.keys(), *latest_items.keys()]
        if str(part_no).strip()
    }
    for part_no in all_part_nos:
        row = row_map.setdefault(
            part_no,
            {
                "part_no": part_no,
                "part_name": (
                    _find_row_description(latest_payload.get("inventory_rows") or [], part_no)
                    or _find_row_description(base_payload.get("inventory_rows") or [], part_no)
                ),
                "base_quantity": _get_inventory_quantity_or_zero(base_payload, part_no),
                "outbound_total": 0.0,
                "inbound_total": 0.0,
                "return_total": 0.0,
                "scrap_total": 0.0,
                "event_count": 0,
            },
        )
        if not row.get("part_name"):
            row["part_name"] = (
                _find_row_description(latest_payload.get("inventory_rows") or [], part_no)
                or _find_row_description(base_payload.get("inventory_rows") or [], part_no)
            )

    rows = []
    totals = {
        "affected_part_count": 0,
        "outbound_total": 0.0,
        "inbound_total": 0.0,
        "return_total": 0.0,
        "scrap_total": 0.0,
        "net_change": 0.0,
        "actual_net_change": 0.0,
        "variance_total": 0.0,
        "aligned_part_count": 0,
        "mismatch_part_count": 0,
    }

    for row in row_map.values():
        base_quantity = float(row["base_quantity"] or 0)
        inbound_total = float(row["inbound_total"] or 0)
        return_total = float(row["return_total"] or 0)
        outbound_total = float(row["outbound_total"] or 0)
        scrap_total = float(row["scrap_total"] or 0)
        email_net_change = inbound_total + return_total - outbound_total - scrap_total
        projected_quantity = base_quantity + email_net_change
        current_quantity = _get_inventory_quantity_or_zero(
            latest_payload,
            row["part_no"],
            fallback=base_quantity,
        )
        actual_delta = current_quantity - base_quantity
        variance = actual_delta - email_net_change
        is_aligned = abs(variance) < 1e-6

        if row["event_count"] <= 0 and abs(actual_delta) < 1e-6:
            continue

        row_payload = {
            **row,
            "base_quantity": base_quantity,
            "net_change": email_net_change,
            "projected_quantity": projected_quantity,
            "current_quantity": current_quantity,
            "actual_delta": actual_delta,
            "variance": variance,
            "is_aligned": is_aligned,
        }
        rows.append(row_payload)

        totals["affected_part_count"] += 1
        totals["outbound_total"] += outbound_total
        totals["inbound_total"] += inbound_total
        totals["return_total"] += return_total
        totals["scrap_total"] += scrap_total
        totals["net_change"] += email_net_change
        totals["actual_net_change"] += actual_delta
        totals["variance_total"] += variance
        if is_aligned:
            totals["aligned_part_count"] += 1
        else:
            totals["mismatch_part_count"] += 1

    rows.sort(
        key=lambda item: (
            0 if not bool(item.get("is_aligned")) else 1,
            -abs(float(item.get("variance") or 0)),
            -abs(float(item.get("actual_delta") or 0)),
            -abs(float(item.get("net_change") or 0)),
            str(item.get("part_no") or ""),
        )
    )

    return {
        "base_record": base_record,
        "latest_record": latest_record,
        "cycle_closed": cycle_closed,
        "cycle_id": int(cycle.id) if cycle is not None else None,
        "locked_at": cycle.locked_at if cycle is not None else None,
        "confirmed_event_count": len(applied_events),
        "pending_event_count": pending_event_count,
        "totals": totals,
        "rows": rows,
    }


async def apply_inventory_adjustment_event(
    db: AsyncSession,
    event: models.InventoryAdjustmentEvent,
    operator_name: str,
    requested_part_no: Optional[str] = None,
    requested_quantity: Optional[float] = None,
    apply_note: Optional[str] = None,
) -> Dict[str, Any]:
    effective_part_no = str(requested_part_no or event.matched_part_no or event.part_no or "").strip()
    if not effective_part_no:
        raise ValueError("异动事件缺少可确认的物料编码，请先人工指定")

    effective_quantity = float(requested_quantity if requested_quantity is not None else (event.quantity or 0))
    if effective_quantity <= 0:
        raise ValueError("异动数量必须大于 0")

    latest_record = await get_latest_official_inventory_record(db)
    latest_payload = _load_inventory_payload(latest_record.raw_data if latest_record else None)
    if latest_record is not None and event.cycle_id is None:
        active_cycle = await ensure_open_reconciliation_cycle(
            db,
            base_record=latest_record,
            actor=operator_name,
            note=f"期初库存表：{latest_record.file_name or latest_record.source_email}",
        )
        event.cycle_id = int(active_cycle.id)
    event.quantity = effective_quantity
    event.status = "applied"
    event.applied_at = datetime.utcnow()
    event.updated_at = datetime.utcnow()
    event.apply_note = apply_note or event.apply_note
    event.matched_part_no = effective_part_no
    event.match_count = 1
    event.matched_part_name = (
        event.matched_part_name
        or _find_row_description(latest_payload.get("inventory_rows") or [], effective_part_no)
        or event.part_name
    )
    await create_audit_log(
        db,
        scope="pmc",
        action="inventory_adjustment_confirmed",
        actor=operator_name,
        entity_type="inventory_adjustment_event",
        entity_id=event.id,
        title="邮件库存变动已确认",
        summary=f"{effective_part_no} × {effective_quantity}",
        detail={
            "event_id": int(event.id),
            "cycle_id": int(event.cycle_id) if event.cycle_id else None,
            "part_no": effective_part_no,
            "quantity": effective_quantity,
            "change_type": event.change_type,
            "subject": event.subject,
        },
    )

    await db.commit()
    await db.refresh(event)

    return {
        "success": True,
        "event_id": event.id,
        "part_no": effective_part_no,
        "quantity": effective_quantity,
        "change_type": event.change_type,
        "confirmed_at": event.applied_at.isoformat() if event.applied_at else None,
    }


async def delete_inventory_adjustment_event(
    db: AsyncSession,
    event: models.InventoryAdjustmentEvent,
    operator_name: str = "system",
) -> Dict[str, Any]:
    if event.status not in ("rejected", "applied"):
        raise ValueError("只有已确认或已忽略的库存异动才能删除")

    event_id = event.id
    deleted_status = event.status
    await create_audit_log(
        db,
        scope="pmc",
        action="inventory_adjustment_deleted",
        actor=operator_name,
        entity_type="inventory_adjustment_event",
        entity_id=event.id,
        title="邮件库存变动已删除",
        summary=event.subject or event.matched_part_no or event.part_no or f"事件 #{event.id}",
        detail={
            "event_id": int(event.id),
            "status": deleted_status,
            "part_no": event.matched_part_no or event.part_no,
            "quantity": float(event.quantity or 0),
        },
    )
    await db.delete(event)
    await db.commit()

    return {
        "success": True,
        "event_id": event_id,
        "deleted_status": deleted_status,
    }


def _load_inventory_payload(raw_data: Optional[str]) -> Dict[str, Any]:
    if not raw_data:
        return {}
    try:
        parsed = json.loads(raw_data)
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}


def _match_inventory_item(
    latest_payload: Dict[str, Any],
    part_no: Optional[str],
    part_name: Optional[str],
) -> tuple[int, Optional[str], Optional[str]]:
    inventory_items = latest_payload.get("items") or {}
    inventory_rows = latest_payload.get("inventory_rows") or []

    normalized_part_no = str(part_no or "").strip().upper()
    if normalized_part_no:
        for key in inventory_items.keys():
            if str(key).strip().upper() == normalized_part_no:
                matched_name = _find_row_description(inventory_rows, key)
                return 1, str(key), matched_name

    normalized_name = str(part_name or "").strip().lower()
    if normalized_name:
        matches = []
        for row in inventory_rows:
            description = str(
                row.get("description")
                or row.get("name")
                or row.get("part_name")
                or ""
            ).strip()
            if normalized_name in description.lower():
                candidate_part_no = str(
                    row.get("part_no")
                    or row.get("raw_part_no")
                    or row.get("code")
                    or ""
                ).strip()
                matches.append((candidate_part_no or None, description or None))
        if matches:
            first_part_no, first_name = matches[0]
            return len(matches), first_part_no, first_name

    return 0, None, None


def _find_row_description(inventory_rows: list[Dict[str, Any]], part_no: Any) -> Optional[str]:
    normalized = str(part_no or "").strip().upper()
    for row in inventory_rows:
        candidate = str(
            row.get("part_no")
            or row.get("raw_part_no")
            or row.get("code")
            or ""
        ).strip().upper()
        if candidate == normalized:
            return str(
                row.get("description")
                or row.get("name")
                or row.get("part_name")
                or ""
            ).strip() or None
    return None


def _get_current_inventory_quantity(parsed_data: Dict[str, Any], part_no: str) -> float:
    normalized = str(part_no or "").strip().upper()
    items = parsed_data.get("items") or {}
    for key, value in items.items():
        if str(key).strip().upper() == normalized:
            return _to_float(value)

    for row in parsed_data.get("inventory_rows") or []:
        candidate = str(
            row.get("part_no")
            or row.get("raw_part_no")
            or row.get("code")
            or ""
        ).strip().upper()
        if candidate != normalized:
            continue
        for field in ("quantity", "good_qty", "total_qty"):
            numeric = _to_float(row.get(field))
            if numeric is not None:
                return numeric
    raise ValueError(f"库存中未找到物料: {part_no}")


def _get_inventory_quantity_or_zero(
    parsed_data: Dict[str, Any],
    part_no: str,
    fallback: Optional[float] = 0.0,
) -> float:
    try:
        return _get_current_inventory_quantity(parsed_data, part_no)
    except Exception:
        return float(fallback or 0)



def _to_float(value: Any) -> Optional[float]:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except Exception:
        return None
