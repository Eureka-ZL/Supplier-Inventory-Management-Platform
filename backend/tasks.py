import logging
import hashlib
import json
from datetime import datetime, timezone
from typing import Set, Dict, Any
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sqlalchemy import select, desc
from services.gmail_service import GmailService
from services.audit_log_service import create_audit_log
from services.bom_override_service import build_inventory_parser_from_database
from services.change_log_service import create_inventory_change_log
from services.inventory_adjustment_runtime_service import get_latest_official_inventory_record
from services.inventory_reconciliation_cycle_service import handle_new_inventory_upload
from database import AsyncSessionLocal
from models import InventoryRecord

logger = logging.getLogger(__name__)

# Initialize scheduler
scheduler = AsyncIOScheduler()

ALLOWED_ATTACHMENT_EXTENSIONS = ('.xlsx', '.xls', '.csv')
INVENTORY_KEYWORDS = (
    '场库明细表',
    '场库明细',
    '美图场库',
)
EXCLUDED_KEYWORDS = (
    '物料齐套测算结果明细',
    '齐套测算结果',
    '物料齐套',
)
MAX_MESSAGES_PER_RUN = 20
SIGNATURE_PREFIX = "ingest_signature:"


def _contains_inventory_keyword(text: str) -> bool:
    value = (text or '').lower()
    return any(keyword.lower() in value for keyword in INVENTORY_KEYWORDS)


def _contains_excluded_keyword(text: str) -> bool:
    value = (text or '').lower()
    return any(keyword.lower() in value for keyword in EXCLUDED_KEYWORDS)


def _is_inventory_candidate(subject: str, filename: str) -> bool:
    merged = f"{subject} {filename}"
    if _contains_excluded_keyword(merged):
        return False
    return _contains_inventory_keyword(subject) or _contains_inventory_keyword(filename)


def _build_attachment_signature(msg_id: str, filename: str, file_data: bytes) -> str:
    file_digest = hashlib.sha256(file_data).hexdigest()
    return f"{msg_id}::{filename}::{file_digest}"


def _extract_signature(notes: str | None) -> str | None:
    if not notes:
        return None
    for line in str(notes).splitlines():
        if line.startswith(SIGNATURE_PREFIX):
            return line[len(SIGNATURE_PREFIX):].strip()
    return None


def _is_valid_inventory_payload(parsed_data: dict) -> bool:
    if not isinstance(parsed_data, dict):
        return False
    if parsed_data.get("error"):
        return False
    items = parsed_data.get("items")
    if not isinstance(items, dict) or not items:
        return False
    numeric_count = 0
    for qty in items.values():
        if isinstance(qty, (int, float)):
            numeric_count += 1
    return numeric_count > 0


def _inventory_invalid_reason(parsed_data: Any) -> str:
    if not isinstance(parsed_data, dict):
        return "解析结果不是有效字典结构"
    if parsed_data.get("error"):
        return str(parsed_data.get("error"))
    items = parsed_data.get("items")
    if not isinstance(items, dict) or not items:
        return "未识别到有效库存编码或数量列"
    numeric_count = sum(1 for qty in items.values() if isinstance(qty, (int, float)))
    if numeric_count <= 0:
        return "库存数量列无有效数值"
    return "未知原因"


def _load_inventory_payload_from_raw(raw_data: str | None) -> Dict[str, Any]:
    if not raw_data:
        return {}
    try:
        parsed = json.loads(raw_data)
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}


def _canonical_inventory_payload(parsed_data: Dict[str, Any]) -> str:
    try:
        return json.dumps(parsed_data or {}, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    except Exception:
        return "{}"


async def _load_existing_signatures(db, limit: int = 5000) -> Set[str]:
    result = await db.execute(
        select(InventoryRecord.notes)
        .order_by(desc(InventoryRecord.parsed_at))
        .limit(limit)
    )
    signatures: Set[str] = set()
    for notes in result.scalars().all():
        signature = _extract_signature(notes)
        if signature:
            signatures.add(signature)
    return signatures


async def _find_record_id_by_signature(db, signature: str) -> int | None:
    result = await db.execute(
        select(InventoryRecord.id)
        .where(InventoryRecord.notes.contains(f"{SIGNATURE_PREFIX}{signature}"))
        .order_by(desc(InventoryRecord.parsed_at))
        .limit(1)
    )
    return result.scalar_one_or_none()


def _build_record_notes(signature: str, msg_id: str, subject: str, filename: str, capacity_notes: str) -> str:
    ingest_meta = {
        "msg_id": msg_id,
        "subject": subject,
        "filename": filename,
    }
    return (
        f"{SIGNATURE_PREFIX}{signature}\n"
        f"ingest_meta:{json.dumps(ingest_meta, ensure_ascii=False)}\n"
        f"{capacity_notes}"
    ).strip()


def _format_received_at_iso(message_detail: Dict[str, Any]) -> str | None:
    internal_date = message_detail.get("internalDate")
    if not internal_date:
        return None
    try:
        dt = datetime.fromtimestamp(int(internal_date) / 1000, tz=timezone.utc)
        return dt.isoformat()
    except Exception:
        return None


def _extract_received_sort_key(message_detail: Dict[str, Any]) -> int:
    internal_date = message_detail.get("internalDate")
    if not internal_date:
        return 0
    try:
        return int(internal_date)
    except Exception:
        return 0


async def sync_latest_inventory_email() -> Dict[str, Any]:
    """
    Manually sync the latest matching inventory email attachment.
    Returns detailed sync payload for frontend real-time display.
    """
    gmail = GmailService()
    if not gmail.is_ready():
        return {
            "success": False,
            "status": "unauthorized",
            "message": "Gmail 尚未授权，请先完成邮箱授权。",
        }

    messages = gmail.search_messages("has:attachment")
    if not messages:
        return {
            "success": True,
            "status": "no_message",
            "message": "未发现含附件的新邮件。",
        }

    async with AsyncSessionLocal() as db:
        parser = await build_inventory_parser_from_database(db)
        existing_signatures = await _load_existing_signatures(db)
        latest_invalid: Dict[str, Any] | None = None
        latest_record = await get_latest_official_inventory_record(db)
        message_batch: list[Dict[str, Any]] = []
        for msg in messages[:MAX_MESSAGES_PER_RUN]:
            msg_id = msg.get("id")
            if not msg_id:
                continue
            message_detail = gmail.get_message_detail(msg_id)
            message_batch.append(
                {
                    "msg_id": msg_id,
                    "detail": message_detail,
                    "sort_key": _extract_received_sort_key(message_detail),
                }
            )

        message_batch.sort(key=lambda row: row.get("sort_key", 0), reverse=True)

        for message in message_batch:
            msg_id = str(message.get("msg_id") or "")
            message_detail = message.get("detail") or {}
            sender = gmail.get_message_sender(message_detail)
            subject = gmail.get_message_subject(message_detail)
            received_at = _format_received_at_iso(message_detail)
            attachments = gmail.get_message_attachments(msg_id)

            candidate_attachment = None
            for filename, file_data in attachments:
                if not filename.lower().endswith(ALLOWED_ATTACHMENT_EXTENSIONS):
                    continue
                if not _is_inventory_candidate(subject, filename):
                    continue
                candidate_attachment = (filename, file_data)
                break

            if candidate_attachment is None:
                continue

            filename, file_data = candidate_attachment
            signature = _build_attachment_signature(msg_id, filename, file_data)
            base_payload = {
                "email": {
                    "message_id": msg_id,
                    "sender": sender,
                    "subject": subject,
                    "received_at": received_at,
                },
                "attachment": {
                    "file_name": filename,
                    "file_size_bytes": len(file_data),
                },
            }

            parsed_data = parser.parse_excel_attachment(file_data, filename)
            if not _is_valid_inventory_payload(parsed_data):
                if latest_invalid is None:
                    latest_invalid = {
                        "status": "invalid",
                        "message": "最新邮件附件无法识别为库存清单，已自动继续查找上一封可识别库存邮件。",
                        "parse_error": _inventory_invalid_reason(parsed_data),
                        **base_payload,
                    }
                continue

            latest_payload = _load_inventory_payload_from_raw(latest_record.raw_data if latest_record else None)
            if latest_record is not None and _canonical_inventory_payload(latest_payload) == _canonical_inventory_payload(parsed_data):
                return {
                    "success": True,
                    "status": "already_current",
                    "message": "当前库存已经是这封最新邮件的版本，无需重复覆盖。",
                    "record_id": latest_record.id,
                    **base_payload,
                }
            reimporting_existing_signature = signature in existing_signatures

            capacity_data = parser.calculate_production_capacity(parsed_data)
            capacity_notes = str(capacity_data.get("notes", "") or "")
            notes = _build_record_notes(signature, msg_id, subject, filename, capacity_notes)

            previous_record = await get_latest_official_inventory_record(db)

            record = InventoryRecord(
                source_email=sender,
                file_name=filename,
                raw_data=json.dumps(parsed_data, ensure_ascii=False),
                calculated_capacity=capacity_data.get("capacity", 0),
                bottleneck_material=capacity_data.get("bottleneck", ""),
                notes=notes,
            )
            db.add(record)
            await db.commit()
            await db.refresh(record)
            await create_inventory_change_log(
                db=db,
                record=record,
                source="gmail_manual_sync",
                previous_record=previous_record,
            )
            await handle_new_inventory_upload(
                db,
                new_record=record,
                actor="system:gmail_manual_sync",
                note=f"期初库存表：{filename}",
            )
            await create_audit_log(
                db,
                scope="pmc",
                action="inventory_sheet_imported_from_email",
                actor="system:gmail_manual_sync",
                entity_type="inventory_record",
                entity_id=record.id,
                title="库存表邮件已导入",
                summary=filename or "未命名库存附件",
                detail={
                    "record_id": int(record.id),
                    "message_id": msg_id,
                    "sender": sender,
                    "subject": subject,
                    "previous_record_id": int(previous_record.id) if previous_record is not None else None,
                },
            )
            await db.commit()
            latest_record = record
            existing_signatures.add(signature)

            return {
                "success": True,
                "status": "imported_fallback" if latest_invalid else "imported",
                "message": (
                    "已导入次新可识别库存邮件附件（最新一封不符合库存表结构）。"
                    if latest_invalid else (
                        "已按最新库存邮件重新覆盖当前库存。"
                        if reimporting_existing_signature else "已导入最新库存邮件附件。"
                    )
                ),
                "record_id": record.id,
                "inventory": {
                    "part_count": len(parsed_data.get("items", {}) or {}),
                    "row_count": int(parsed_data.get("inventory_row_count") or len(parsed_data.get("inventory_rows") or [])),
                },
                "capacity": {
                    "best_capacity": int(capacity_data.get("capacity", 0) or 0),
                    "bottleneck": str(capacity_data.get("bottleneck", "") or ""),
                },
                "skipped_latest": latest_invalid,
                **base_payload,
            }

        if latest_invalid is not None:
            return {
                "success": True,
                **latest_invalid,
            }

        return {
            "success": True,
            "status": "no_candidate",
            "message": "最新邮件中未找到匹配的库存附件（按主题/附件名关键词筛选）。",
        }

async def poll_inventory_emails():
    """Background task to poll Gmail for inventory updates"""
    logger.info("Starting scheduled task: poll_inventory_emails")

    # Initialize services (OAuth2 - no params needed)
    gmail = GmailService()

    if not gmail.is_ready():
        logger.warning("Gmail service not authorized. Run: python backend/authorize_gmail.py")
        return

    try:
        # Pull only messages with spreadsheet-like attachments first.
        messages = gmail.search_messages("has:attachment")

        if not messages:
            logger.info("No new inventory emails found.")
            return

        async with AsyncSessionLocal() as db:
            parser = await build_inventory_parser_from_database(db)
            existing_signatures = await _load_existing_signatures(db)
            run_signatures: Set[str] = set()
            processed_count = 0
            latest_record = await get_latest_official_inventory_record(db)

            message_batch: list[Dict[str, Any]] = []
            for msg in messages[:MAX_MESSAGES_PER_RUN]:
                msg_id = msg.get('id')
                if not msg_id:
                    continue
                msg_detail = gmail.get_message_detail(msg_id)
                message_batch.append(
                    {
                        "msg_id": msg_id,
                        "detail": msg_detail,
                        "sort_key": _extract_received_sort_key(msg_detail),
                    }
                )

            message_batch.sort(key=lambda row: row.get("sort_key", 0), reverse=True)

            for message in message_batch:
                msg_id = str(message.get("msg_id") or "")
                msg_detail = message.get("detail") or {}

                # Get sender info
                sender = gmail.get_message_sender(msg_detail)
                subject = gmail.get_message_subject(msg_detail)

                attachments = gmail.get_message_attachments(msg_id)

                for filename, file_data in attachments:
                    if not filename.lower().endswith(ALLOWED_ATTACHMENT_EXTENSIONS):
                        continue

                    # Fast keyword pre-filter (sender not fixed).
                    if not _is_inventory_candidate(subject, filename):
                        logger.info(
                            "Skip non-inventory candidate attachment: %s (subject=%s)",
                            filename,
                            subject,
                        )
                        continue

                    signature = _build_attachment_signature(msg_id, filename, file_data)
                    if signature in run_signatures:
                        logger.info("Skip duplicated attachment within current run: %s", filename)
                        continue

                    logger.info("Processing attachment: %s from %s", filename, sender)

                    # Structure validation by parser success + effective inventory rows.
                    parsed_data = parser.parse_excel_attachment(file_data, filename)
                    if not _is_valid_inventory_payload(parsed_data):
                        logger.info("Skip invalid inventory attachment after parse: %s", filename)
                        continue

                    latest_payload = _load_inventory_payload_from_raw(latest_record.raw_data if latest_record else None)
                    if latest_record is not None and _canonical_inventory_payload(latest_payload) == _canonical_inventory_payload(parsed_data):
                        logger.info("Latest inventory already matches newest email attachment: %s", filename)
                        return

                    reimporting_existing_signature = signature in existing_signatures

                    # Calculate capacity
                    capacity_data = parser.calculate_production_capacity(parsed_data)
                    capacity_notes = str(capacity_data.get("notes", "") or "")
                    notes = _build_record_notes(signature, msg_id, subject, filename, capacity_notes)

                    previous_record = await get_latest_official_inventory_record(db)

                    # Save to Database
                    record = InventoryRecord(
                        source_email=sender,
                        file_name=filename,
                        raw_data=json.dumps(parsed_data, ensure_ascii=False),
                        calculated_capacity=capacity_data.get("capacity", 0),
                        bottleneck_material=capacity_data.get("bottleneck", ""),
                        notes=notes,
                    )
                    db.add(record)
                    await db.commit()
                    await db.refresh(record)
                    await create_inventory_change_log(
                        db=db,
                        record=record,
                        source="gmail_scheduler_reimport" if reimporting_existing_signature else "gmail_scheduler",
                        previous_record=previous_record,
                    )
                    await handle_new_inventory_upload(
                        db,
                        new_record=record,
                        actor="system:gmail_scheduler",
                        note=f"期初库存表：{filename}",
                    )
                    await create_audit_log(
                        db,
                        scope="pmc",
                        action="inventory_sheet_imported_from_email",
                        actor="system:gmail_scheduler",
                        entity_type="inventory_record",
                        entity_id=record.id,
                        title="库存表邮件已导入",
                        summary=filename or "未命名库存附件",
                        detail={
                            "record_id": int(record.id),
                            "message_id": msg_id,
                            "sender": sender,
                            "subject": subject,
                            "previous_record_id": int(previous_record.id) if previous_record is not None else None,
                            "reimport": bool(reimporting_existing_signature),
                        },
                    )
                    await db.commit()
                    existing_signatures.add(signature)
                    run_signatures.add(signature)
                    latest_record = record
                    processed_count += 1
                    logger.info(
                        "Recorded capacity: %s (bottleneck: %s, reimport=%s)",
                        capacity_data.get("capacity"),
                        capacity_data.get("bottleneck"),
                        reimporting_existing_signature,
                    )
                    # Keep only the latest valid inventory import for scheduler runs.
                    logger.info("poll_inventory_emails done, processed %s valid attachment(s)", processed_count)
                    return
            logger.info("poll_inventory_emails done, processed %s valid attachment(s)", processed_count)

    except Exception as e:
        logger.error(f"Error in poll_inventory_emails: {str(e)}")

def start_scheduler():
    """Start the background scheduler"""
    if not scheduler.running:
        scheduler.add_job(poll_inventory_emails, 'interval', minutes=60)
        scheduler.start()
        logger.info("Background scheduler started: polling emails every 60 minutes")
