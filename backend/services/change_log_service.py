import json
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Any, Dict, List, Set, Tuple

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

import models
from services.bom_override_service import build_inventory_parser_from_database
from services.inventory_excel_parser import is_trusted_inventory_part_no, normalize_part_no
from services.inventory_parser import InventoryParser


def _safe_float(value: Any) -> float:
    try:
        return float(value)
    except Exception:
        return 0.0


def _compact_number(value: float) -> float | int:
    if float(value).is_integer():
        return int(value)
    return value


def _load_inventory_items_from_raw(raw_data: str | None) -> Dict[str, float]:
    if not raw_data:
        return {}
    try:
        parsed = json.loads(raw_data)
    except Exception:
        return {}
    if not isinstance(parsed, dict):
        return {}

    raw_alias_map: Dict[str, str] = {}
    inventory_rows = parsed.get("inventory_rows")
    if isinstance(inventory_rows, list):
        for row in inventory_rows:
            if not isinstance(row, dict):
                continue
            part_no = normalize_part_no(str(row.get("part_no") or row.get("raw_part_no") or "").strip())
            if not part_no:
                continue
            raw_part_no = str(row.get("raw_part_no", "") or "").strip()
            if not raw_part_no:
                continue
            existing_alias = raw_alias_map.get(part_no, "")
            if raw_part_no and raw_part_no not in existing_alias:
                raw_alias_map[part_no] = f"{existing_alias} / {raw_part_no}".strip(" /")

    items = parsed.get("items")
    if not isinstance(items, dict):
        return {}
    normalized: Dict[str, float] = {}
    for key, value in items.items():
        part_no = normalize_part_no(str(key or "").strip())
        if not part_no:
            continue
        if not is_trusted_inventory_part_no(part_no, raw_alias_map.get(part_no, "")):
            continue
        normalized[part_no] = _safe_float(value)
    return normalized


def _load_inventory_item_meta_from_raw(raw_data: str | None) -> Dict[str, Dict[str, Any]]:
    if not raw_data:
        return {}
    try:
        parsed = json.loads(raw_data)
    except Exception:
        return {}
    if not isinstance(parsed, dict):
        return {}

    inventory_rows = parsed.get("inventory_rows")
    if not isinstance(inventory_rows, list):
        return {}

    meta_map: Dict[str, Dict[str, Any]] = {}
    for row in inventory_rows:
        if not isinstance(row, dict):
            continue
        part_no = str(row.get("part_no", "") or "").strip()
        if not part_no:
            continue

        current_meta = meta_map.setdefault(part_no, {})
        description = str(row.get("description", "") or "").strip()
        raw_part_no = str(row.get("raw_part_no", "") or "").strip()

        if description and not current_meta.get("description"):
            current_meta["description"] = description
        if raw_part_no and not current_meta.get("raw_part_no"):
            current_meta["raw_part_no"] = raw_part_no

    return meta_map


def _enrich_inventory_detail_with_meta(
    detail: Dict[str, Any],
    previous_meta: Dict[str, Dict[str, Any]],
    current_meta: Dict[str, Dict[str, Any]],
) -> Dict[str, Any]:
    enriched_detail = dict(detail)

    for key in ("added", "removed", "changed"):
        rows = enriched_detail.get(key)
        if not isinstance(rows, list):
            continue

        enriched_rows: List[Dict[str, Any]] = []
        for row in rows:
            if not isinstance(row, dict):
                enriched_rows.append(row)
                continue

            part_no = str(row.get("part_no", "") or "").strip()
            meta = current_meta.get(part_no) or previous_meta.get(part_no) or {}
            enriched_row = dict(row)

            description = str(meta.get("description", "") or "").strip()
            raw_part_no = str(meta.get("raw_part_no", "") or "").strip()

            if description:
                enriched_row["description"] = description
            if raw_part_no and not enriched_row.get("raw_part_no"):
                enriched_row["raw_part_no"] = raw_part_no

            enriched_rows.append(enriched_row)

        enriched_detail[key] = enriched_rows

    return enriched_detail


def build_inventory_diff(
    previous_items: Dict[str, float],
    current_items: Dict[str, float],
) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    prev_keys = set(previous_items.keys())
    curr_keys = set(current_items.keys())

    added_keys = sorted(curr_keys - prev_keys)
    removed_keys = sorted(prev_keys - curr_keys)
    common_keys = sorted(prev_keys & curr_keys)

    added = [
        {"part_no": key, "new_qty": _compact_number(current_items.get(key, 0.0))}
        for key in added_keys
    ]
    removed = [
        {"part_no": key, "old_qty": _compact_number(previous_items.get(key, 0.0))}
        for key in removed_keys
    ]

    changed: List[Dict[str, Any]] = []
    qty_increased_count = 0
    qty_decreased_count = 0
    qty_unchanged_count = 0
    for key in common_keys:
        old_qty = _safe_float(previous_items.get(key, 0.0))
        new_qty = _safe_float(current_items.get(key, 0.0))
        delta = new_qty - old_qty
        if abs(delta) < 1e-9:
            qty_unchanged_count += 1
            continue
        if delta > 0:
            qty_increased_count += 1
            change_type = "increase"
        else:
            qty_decreased_count += 1
            change_type = "decrease"
        changed.append(
            {
                "part_no": key,
                "old_qty": _compact_number(old_qty),
                "new_qty": _compact_number(new_qty),
                "delta": _compact_number(delta),
                "change_type": change_type,
            }
        )

    changed.sort(key=lambda row: abs(_safe_float(row.get("delta", 0.0))), reverse=True)

    total_old_qty = sum(_safe_float(v) for v in previous_items.values())
    total_new_qty = sum(_safe_float(v) for v in current_items.values())
    total_delta = total_new_qty - total_old_qty

    summary = {
        "part_added_count": len(added),
        "part_removed_count": len(removed),
        "qty_increased_count": qty_increased_count,
        "qty_decreased_count": qty_decreased_count,
        "qty_unchanged_count": qty_unchanged_count,
        "previous_part_count": len(previous_items),
        "current_part_count": len(current_items),
        "total_old_qty": _compact_number(total_old_qty),
        "total_new_qty": _compact_number(total_new_qty),
        "total_qty_delta": _compact_number(total_delta),
    }
    detail = {
        "added": added,
        "removed": removed,
        "changed": changed,
    }
    return summary, detail


async def create_inventory_change_log(
    db: AsyncSession,
    record: models.InventoryRecord,
    source: str,
    previous_record: models.InventoryRecord | None,
) -> models.InventoryChangeLog:
    previous_items = _load_inventory_items_from_raw(previous_record.raw_data if previous_record else None)
    current_items = _load_inventory_items_from_raw(record.raw_data)
    summary, detail = build_inventory_diff(previous_items, current_items)

    change_log = models.InventoryChangeLog(
        source=source,
        source_email=record.source_email,
        file_name=record.file_name,
        record_id=record.id,
        previous_record_id=previous_record.id if previous_record else None,
        summary_json=json.dumps(summary, ensure_ascii=False),
        detail_json=json.dumps(detail, ensure_ascii=False),
    )
    db.add(change_log)
    return change_log


def _normalize_part_key_for_diff(part: Dict[str, Any]) -> str:
    part_no = str(part.get("part_no", "") or "").strip()
    alt_group = part.get("alt_group")
    alt_label = ""
    if alt_group not in (None, ""):
        try:
            alt_label = str(int(float(alt_group)))
        except Exception:
            alt_label = str(alt_group)
    return f"{part_no}::alt:{alt_label}"


def _normalize_alt_group(part: Dict[str, Any]) -> int | None:
    raw = part.get("alt_group")
    if raw in (None, ""):
        return None
    try:
        value = int(float(raw))
    except Exception:
        return None
    return value if value > 0 else None


def _build_common_group_index(parts: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    groups: Dict[str, List[Dict[str, Any]]] = {}
    for part in parts:
        group = _normalize_alt_group(part)
        if group is None:
            continue
        key = str(group)
        groups.setdefault(key, []).append(
            {
                "part_no": str(part.get("part_no", "") or "").strip(),
                "name": str(part.get("name", "") or "").strip(),
                "spec": str(part.get("spec", "") or "").strip(),
                "manufacturer": str(part.get("manufacturer", "") or "").strip(),
                "qty": _compact_number(_safe_float(part.get("qty", 0))),
            }
        )
    for key in groups.keys():
        groups[key] = sorted(
            groups[key],
            key=lambda row: (str(row.get("part_no", "")), str(row.get("name", ""))),
        )
    return groups


def _common_group_signature(parts: List[Dict[str, Any]]) -> str:
    return json.dumps(parts, ensure_ascii=False, sort_keys=True)


def build_bom_parts_diff(
    before_parts: List[Dict[str, Any]],
    after_parts: List[Dict[str, Any]],
) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    before_map: Dict[str, Dict[str, Any]] = {}
    after_map: Dict[str, Dict[str, Any]] = {}
    for part in before_parts:
        before_map[_normalize_part_key_for_diff(part)] = part
    for part in after_parts:
        after_map[_normalize_part_key_for_diff(part)] = part

    before_keys = set(before_map.keys())
    after_keys = set(after_map.keys())

    added_keys = sorted(after_keys - before_keys)
    removed_keys = sorted(before_keys - after_keys)
    common_keys = sorted(before_keys & after_keys)

    added = [after_map[key] for key in added_keys]
    removed = [before_map[key] for key in removed_keys]

    updated: List[Dict[str, Any]] = []
    for key in common_keys:
        before = before_map[key]
        after = after_map[key]
        if (
            str(before.get("name", "") or "").strip() != str(after.get("name", "") or "").strip()
            or str(before.get("spec", "") or "").strip() != str(after.get("spec", "") or "").strip()
            or str(before.get("manufacturer", "") or "").strip() != str(after.get("manufacturer", "") or "").strip()
            or abs(_safe_float(before.get("qty", 0.0)) - _safe_float(after.get("qty", 0.0))) > 1e-9
        ):
            updated.append({"before": before, "after": after})

    # Enrich row-level change details with common-material markers
    def enrich_common_marker(part: Dict[str, Any]) -> Dict[str, Any]:
        normalized = dict(part)
        group = _normalize_alt_group(part)
        normalized["alt_group"] = group
        normalized["is_common"] = group is not None
        return normalized

    added = [enrich_common_marker(row) for row in added]
    removed = [enrich_common_marker(row) for row in removed]
    updated = [
        {
            "before": enrich_common_marker(row.get("before", {})),
            "after": enrich_common_marker(row.get("after", {})),
        }
        for row in updated
    ]

    # Common-group level change summary
    before_common_groups = _build_common_group_index(before_parts)
    after_common_groups = _build_common_group_index(after_parts)
    before_group_keys = set(before_common_groups.keys())
    after_group_keys = set(after_common_groups.keys())
    added_group_keys = sorted(after_group_keys - before_group_keys, key=lambda x: int(x))
    removed_group_keys = sorted(before_group_keys - after_group_keys, key=lambda x: int(x))
    common_group_keys = sorted(before_group_keys & after_group_keys, key=lambda x: int(x))
    updated_groups: List[Dict[str, Any]] = []
    for group_key in common_group_keys:
        before_group = before_common_groups.get(group_key, [])
        after_group = after_common_groups.get(group_key, [])
        if _common_group_signature(before_group) != _common_group_signature(after_group):
            updated_groups.append(
                {
                    "group": int(group_key),
                    "before_parts": before_group,
                    "after_parts": after_group,
                }
            )
    common_groups_detail = {
        "added": [
            {"group": int(group_key), "parts": after_common_groups.get(group_key, [])}
            for group_key in added_group_keys
        ],
        "removed": [
            {"group": int(group_key), "parts": before_common_groups.get(group_key, [])}
            for group_key in removed_group_keys
        ],
        "updated": updated_groups,
    }
    common_change_count = (
        len(common_groups_detail["added"])
        + len(common_groups_detail["removed"])
        + len(common_groups_detail["updated"])
    )
    common_added_part_count = sum(1 for row in added if row.get("is_common"))
    common_removed_part_count = sum(1 for row in removed if row.get("is_common"))
    common_updated_part_count = sum(
        1
        for row in updated
        if row.get("before", {}).get("is_common") or row.get("after", {}).get("is_common")
    )

    summary = {
        "added_count": len(added),
        "removed_count": len(removed),
        "updated_count": len(updated),
        "before_total_parts": len(before_parts),
        "after_total_parts": len(after_parts),
        "common_group_added_count": len(common_groups_detail["added"]),
        "common_group_removed_count": len(common_groups_detail["removed"]),
        "common_group_updated_count": len(common_groups_detail["updated"]),
        "common_group_change_count": common_change_count,
        "common_part_added_count": common_added_part_count,
        "common_part_removed_count": common_removed_part_count,
        "common_part_updated_count": common_updated_part_count,
    }
    detail = {
        "added": added,
        "removed": removed,
        "updated": updated,
        "common_groups": common_groups_detail,
    }
    return summary, detail


async def create_bom_change_log(
    db: AsyncSession,
    *,
    changed_by: str,
    product_code: str,
    product_name: str,
    line: str,
    source_file: str,
    before_parts: List[Dict[str, Any]],
    after_parts: List[Dict[str, Any]],
) -> models.BomChangeLog | None:
    summary, detail = build_bom_parts_diff(before_parts, after_parts)
    if (
        summary.get("added_count", 0) == 0
        and summary.get("removed_count", 0) == 0
        and summary.get("updated_count", 0) == 0
    ):
        return None

    log = models.BomChangeLog(
        changed_by=changed_by,
        product_code=product_code,
        product_name=product_name,
        line=line,
        source_file=source_file,
        summary_json=json.dumps(summary, ensure_ascii=False),
        detail_json=json.dumps(detail, ensure_ascii=False),
    )
    db.add(log)
    return log


def _safe_json_load(raw: str | None) -> Dict[str, Any]:
    if not raw:
        return {}
    try:
        data = json.loads(raw)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _build_parent_index(
    bom_models_all: Dict[str, Dict[str, Any]],
    code_index: Dict[str, Dict[str, Any]],
) -> Dict[str, Set[str]]:
    parent_index: Dict[str, Set[str]] = defaultdict(set)
    valid_codes = set(code_index.keys())
    for model in bom_models_all.values():
        parent_code = str(model.get("product_code", "") or "").strip()
        if not parent_code:
            continue
        for child_code in (model.get("fixed_parts") or {}).keys():
            child = str(child_code or "").strip()
            if child in valid_codes and child != parent_code:
                parent_index[child].add(parent_code)
        for group in model.get("alternative_groups") or []:
            for option in group.get("options") or []:
                child = str(option.get("part_no", "") or "").strip()
                if child in valid_codes and child != parent_code:
                    parent_index[child].add(parent_code)
    return parent_index


def _build_history_node(
    code: str,
    code_index: Dict[str, Dict[str, Any]],
    *,
    fallback_name: str = "",
    fallback_line: str = "",
) -> Dict[str, Any]:
    model = code_index.get(str(code or "").strip())
    resolved_code = str(code or "").strip()
    resolved_name = fallback_name
    resolved_line = fallback_line
    if model:
        resolved_code = str(model.get("product_code", "") or "").strip() or resolved_code
        resolved_name = str(model.get("product_name", "") or "").strip() or resolved_name
        resolved_line = str(model.get("line", "") or "").strip() or resolved_line
    tier = InventoryParser._resolve_bom_tier(resolved_code)
    return {
        "code": resolved_code,
        "name": resolved_name or resolved_code or "未命名节点",
        "line": resolved_line,
        "tier": tier,
        "tier_label": InventoryParser._resolve_bom_tier_label(tier),
    }


def _collect_finished_paths(
    changed_code: str,
    code_index: Dict[str, Dict[str, Any]],
    parent_index: Dict[str, Set[str]],
    finished_codes: Set[str],
) -> List[List[str]]:
    start = str(changed_code or "").strip()
    if not start:
        return []

    if start in finished_codes:
        return [[start]]

    paths: List[List[str]] = []

    def dfs(current: str, trail: List[str], visited: Set[str]) -> None:
        parents = sorted(parent_index.get(current, set()))
        if not parents:
            return
        for parent in parents:
            if parent in visited:
                continue
            next_trail = trail + [parent]
            if parent in finished_codes:
                paths.append(list(reversed(next_trail)))
                continue
            dfs(parent, next_trail, visited | {parent})

    dfs(start, [start], {start})

    deduped: List[List[str]] = []
    seen: Set[Tuple[str, ...]] = set()
    for path in paths:
        token = tuple(path)
        if token in seen:
            continue
        seen.add(token)
        deduped.append(path)
    return deduped


def _project_bom_change_event_rows(
    row: models.BomChangeLog,
    summary: Dict[str, Any],
    detail: Dict[str, Any],
    *,
    code_index: Dict[str, Dict[str, Any]],
    parent_index: Dict[str, Set[str]],
    finished_codes: Set[str],
) -> List[Dict[str, Any]]:
    changed_code = str(row.product_code or "").strip()
    changed_node = _build_history_node(
        changed_code,
        code_index,
        fallback_name=str(row.product_name or "").strip(),
        fallback_line=str(row.line or "").strip(),
    )
    changed_paths = _collect_finished_paths(changed_code, code_index, parent_index, finished_codes)
    if not changed_paths:
        changed_paths = [[changed_code]] if changed_code else []

    grouped_paths: Dict[str, List[List[str]]] = defaultdict(list)
    for path in changed_paths:
        if not path:
            continue
        grouped_paths[path[0]].append(path)

    if not grouped_paths:
        grouped_paths[changed_code or f"log-{row.id}"] = [[changed_code]] if changed_code else [[]]

    events: List[Dict[str, Any]] = []
    affected_root_codes = [code for code in grouped_paths.keys() if code]

    for root_code, root_paths in grouped_paths.items():
        root_node = _build_history_node(
            root_code,
            code_index,
            fallback_name=str(row.product_name or "").strip(),
            fallback_line=str(row.line or "").strip(),
        )
        impact_paths = []
        for path in root_paths:
            nodes = [
                _build_history_node(code, code_index)
                for code in path
                if str(code or "").strip()
            ]
            if nodes:
                impact_paths.append(nodes)

        event_detail = dict(detail)
        event_detail["impact_context"] = {
            "root_node": root_node,
            "changed_node": changed_node,
            "impact_paths": impact_paths,
            "affected_finished_count": len(affected_root_codes) or 1,
            "affected_finished_codes": affected_root_codes or ([root_node.get("code")] if root_node.get("code") else []),
            "is_direct_finished_change": root_node.get("code") == changed_node.get("code"),
        }

        event_summary = dict(summary)
        event_summary["affected_finished_count"] = len(affected_root_codes) or 1

        root_code_clean = str(root_node.get("code") or "").strip()
        root_name = str(root_node.get("name") or "").strip()
        root_line = str(root_node.get("line") or "").strip()
        changed_tier_label = str(changed_node.get("tier_label") or "").strip()

        events.append(
            {
                "event_type": "bom_change",
                "event_time": row.changed_at.isoformat() if row.changed_at else None,
                "event_id": f"bom-{row.id}-{root_code_clean or 'unknown'}",
                "title": f"BOM变更 · {root_name or root_code_clean or row.product_name or row.product_code}",
                "subtitle": f"{root_line or '未分类'} · {root_code_clean or row.product_code}",
                "operator": row.changed_by or "",
                "line": root_line,
                "product_code": root_code_clean,
                "product_name": root_name,
                "source_file": row.source_file or "",
                "summary": event_summary,
                "detail": event_detail,
                "root_product_code": root_code_clean,
                "root_product_name": root_name,
                "changed_product_code": changed_code,
                "changed_product_name": str(changed_node.get('name') or ''),
                "changed_tier_label": changed_tier_label,
                "is_deleted": bool(getattr(row, "is_deleted", False)),
                "deleted_at": row.deleted_at.isoformat() if getattr(row, "deleted_at", None) else None,
                "deleted_by": getattr(row, "deleted_by", None),
            }
        )

    return events


async def fetch_pmc_history_events(
    db: AsyncSession,
    limit: int = 100,
    include_deleted: bool = False,
    deleted_only: bool = False,
) -> List[Dict[str, Any]]:
    parser = await build_inventory_parser_from_database(db)
    bom_models_all = parser._extract_bom_models()
    code_index = parser._build_product_code_index(bom_models_all)
    finished_models = parser._get_finished_models(bom_models_all)
    finished_codes = {
        str(model.get("product_code", "") or "").strip()
        for model in finished_models.values()
        if str(model.get("product_code", "") or "").strip()
    }
    parent_index = _build_parent_index(bom_models_all, code_index)

    bom_stmt = select(models.BomChangeLog)
    if deleted_only:
        bom_stmt = bom_stmt.where(models.BomChangeLog.is_deleted.is_(True))
    elif not include_deleted:
        bom_stmt = bom_stmt.where(models.BomChangeLog.is_deleted.is_(False))
    bom_result = await db.execute(
        bom_stmt.order_by(models.BomChangeLog.changed_at.desc()).limit(limit)
    )
    bom_logs = bom_result.scalars().all()

    inventory_stmt = select(models.InventoryChangeLog)
    if deleted_only:
        inventory_stmt = inventory_stmt.where(models.InventoryChangeLog.is_deleted.is_(True))
    elif not include_deleted:
        inventory_stmt = inventory_stmt.where(models.InventoryChangeLog.is_deleted.is_(False))
    inventory_result = await db.execute(
        inventory_stmt.order_by(models.InventoryChangeLog.changed_at.desc()).limit(limit)
    )
    inventory_logs = inventory_result.scalars().all()

    audit_stmt = select(models.AuditLog)
    if deleted_only:
        audit_stmt = audit_stmt.where(models.AuditLog.is_deleted.is_(True))
    elif not include_deleted:
        audit_stmt = audit_stmt.where(models.AuditLog.is_deleted.is_(False))
    audit_result = await db.execute(
        audit_stmt.order_by(models.AuditLog.created_at.desc()).limit(limit)
    )
    audit_logs = audit_result.scalars().all()

    inventory_record_ids: Set[int] = set()
    for row in inventory_logs:
        if row.record_id:
            inventory_record_ids.add(int(row.record_id))
        if row.previous_record_id:
            inventory_record_ids.add(int(row.previous_record_id))

    inventory_record_map: Dict[int, models.InventoryRecord] = {}
    if inventory_record_ids:
        records_result = await db.execute(
            select(models.InventoryRecord).where(models.InventoryRecord.id.in_(inventory_record_ids))
        )
        inventory_record_map = {
            int(record.id): record
            for record in records_result.scalars().all()
            if getattr(record, "id", None) is not None
        }

    events: List[Dict[str, Any]] = []

    for row in bom_logs:
        summary = _safe_json_load(row.summary_json)
        detail = _safe_json_load(row.detail_json)
        events.extend(
            _project_bom_change_event_rows(
                row,
                summary,
                detail,
                code_index=code_index,
                parent_index=parent_index,
                finished_codes=finished_codes,
            )
        )

    for row in inventory_logs:
        current_record = inventory_record_map.get(int(row.record_id)) if row.record_id else None
        previous_record = inventory_record_map.get(int(row.previous_record_id)) if row.previous_record_id else None
        if current_record is not None:
            previous_items = _load_inventory_items_from_raw(previous_record.raw_data if previous_record else None)
            current_items = _load_inventory_items_from_raw(current_record.raw_data)
            summary, detail = build_inventory_diff(previous_items, current_items)
        else:
            summary = _safe_json_load(row.summary_json)
            detail = _safe_json_load(row.detail_json)
        detail = _enrich_inventory_detail_with_meta(
            detail,
            previous_meta=_load_inventory_item_meta_from_raw(previous_record.raw_data if previous_record else None),
            current_meta=_load_inventory_item_meta_from_raw(current_record.raw_data if current_record else None),
        )
        events.append(
            {
                "event_type": "inventory_change",
                "event_time": row.changed_at.isoformat() if row.changed_at else None,
                "event_id": f"inv-{row.id}",
                "title": f"库存更新 · {row.file_name or '未命名附件'}",
                "subtitle": f"{row.source_email or ''}",
                "operator": row.source or "",
                "source_file": row.file_name or "",
                "record_id": row.record_id,
                "previous_record_id": row.previous_record_id,
                "summary": summary,
                "detail": detail,
                "is_deleted": bool(getattr(row, "is_deleted", False)),
                "deleted_at": row.deleted_at.isoformat() if getattr(row, "deleted_at", None) else None,
                "deleted_by": getattr(row, "deleted_by", None),
            }
        )

    for row in audit_logs:
        detail = _safe_json_load(row.detail_json)
        events.append(
            {
                "event_type": "audit_log",
                "event_time": row.created_at.isoformat() if row.created_at else None,
                "event_id": f"audit-{row.id}",
                "title": row.title,
                "subtitle": row.summary or "",
                "operator": row.actor or "",
                "source_file": "",
                "summary": {
                    "audit_scope": row.scope,
                    "audit_action": row.action,
                },
                "detail": detail,
                "is_deleted": bool(getattr(row, "is_deleted", False)),
                "deleted_at": row.deleted_at.isoformat() if getattr(row, "deleted_at", None) else None,
                "deleted_by": getattr(row, "deleted_by", None),
            }
        )

    events.sort(key=lambda e: str(e.get("event_time") or ""), reverse=True)
    return events[:limit]


async def soft_delete_pmc_history_event(
    db: AsyncSession,
    *,
    event_type: str,
    event_id: int,
    deleted_by: str,
) -> bool:
    now = datetime.utcnow()
    if event_type == "bom_change":
        row = await db.get(models.BomChangeLog, event_id)
    elif event_type == "inventory_change":
        row = await db.get(models.InventoryChangeLog, event_id)
    elif event_type == "audit_log":
        row = await db.get(models.AuditLog, event_id)
    else:
        raise ValueError("unsupported_event_type")

    if row is None or getattr(row, "is_deleted", False):
        return False

    row.is_deleted = True
    row.deleted_at = now
    row.deleted_by = deleted_by
    return True


async def restore_pmc_history_event(
    db: AsyncSession,
    *,
    event_type: str,
    event_id: int,
) -> bool:
    if event_type == "bom_change":
        row = await db.get(models.BomChangeLog, event_id)
    elif event_type == "inventory_change":
        row = await db.get(models.InventoryChangeLog, event_id)
    elif event_type == "audit_log":
        row = await db.get(models.AuditLog, event_id)
    else:
        raise ValueError("unsupported_event_type")

    if row is None or not getattr(row, "is_deleted", False):
        return False

    row.is_deleted = False
    row.deleted_at = None
    row.deleted_by = None
    return True


async def soft_delete_pmc_history_events(
    db: AsyncSession,
    *,
    events: List[Dict[str, Any]],
    deleted_by: str,
) -> int:
    deleted_count = 0
    for item in events:
        event_type = str(item.get("event_type") or "").strip()
        event_id = int(item.get("event_id") or 0)
        if not event_type or not event_id:
            continue
        deleted = await soft_delete_pmc_history_event(
            db,
            event_type=event_type,
            event_id=event_id,
            deleted_by=deleted_by,
        )
        if deleted:
            deleted_count += 1
    return deleted_count


async def restore_pmc_history_events(
    db: AsyncSession,
    *,
    events: List[Dict[str, Any]],
) -> int:
    restored_count = 0
    for item in events:
        event_type = str(item.get("event_type") or "").strip()
        event_id = int(item.get("event_id") or 0)
        if not event_type or not event_id:
            continue
        restored = await restore_pmc_history_event(
            db,
            event_type=event_type,
            event_id=event_id,
        )
        if restored:
            restored_count += 1
    return restored_count


async def permanently_delete_pmc_history_event(
    db: AsyncSession,
    *,
    event_type: str,
    event_id: int,
) -> bool:
    if event_type == "bom_change":
        row = await db.get(models.BomChangeLog, event_id)
    elif event_type == "inventory_change":
        row = await db.get(models.InventoryChangeLog, event_id)
    elif event_type == "audit_log":
        row = await db.get(models.AuditLog, event_id)
    else:
        raise ValueError("unsupported_event_type")

    if row is None or not getattr(row, "is_deleted", False):
        return False

    await db.delete(row)
    return True


async def permanently_delete_pmc_history_events(
    db: AsyncSession,
    *,
    events: List[Dict[str, Any]],
) -> int:
    deleted_count = 0
    for item in events:
        event_type = str(item.get("event_type") or "").strip()
        event_id = int(item.get("event_id") or 0)
        if not event_type or not event_id:
            continue
        deleted = await permanently_delete_pmc_history_event(
            db,
            event_type=event_type,
            event_id=event_id,
        )
        if deleted:
            deleted_count += 1
    return deleted_count


async def cleanup_old_pmc_history_events(
    db: AsyncSession,
    *,
    older_than_days: int,
    deleted_by: str,
    event_scope: str = "all",
) -> Dict[str, int]:
    cutoff = datetime.utcnow() - timedelta(days=max(1, older_than_days))
    now = datetime.utcnow()
    result = {"bom_change": 0, "inventory_change": 0, "audit_log": 0}

    if event_scope in {"all", "bom_change"}:
        bom_result = await db.execute(
            select(models.BomChangeLog).where(
                models.BomChangeLog.is_deleted.is_(False),
                models.BomChangeLog.changed_at < cutoff,
            )
        )
        for row in bom_result.scalars().all():
            row.is_deleted = True
            row.deleted_at = now
            row.deleted_by = deleted_by
            result["bom_change"] += 1

    if event_scope in {"all", "inventory_change"}:
        inventory_result = await db.execute(
            select(models.InventoryChangeLog).where(
                models.InventoryChangeLog.is_deleted.is_(False),
                models.InventoryChangeLog.changed_at < cutoff,
            )
        )
        for row in inventory_result.scalars().all():
            row.is_deleted = True
            row.deleted_at = now
            row.deleted_by = deleted_by
            result["inventory_change"] += 1

    if event_scope in {"all", "audit_log"}:
        audit_result = await db.execute(
            select(models.AuditLog).where(
                models.AuditLog.is_deleted.is_(False),
                models.AuditLog.created_at < cutoff,
            )
        )
        for row in audit_result.scalars().all():
            row.is_deleted = True
            row.deleted_at = now
            row.deleted_by = deleted_by
            result["audit_log"] += 1

    return result


async def count_pmc_history_stats(db: AsyncSession) -> Dict[str, int]:
    from sqlalchemy import func

    bom_active = await db.scalar(
        select(func.count(models.BomChangeLog.id)).where(models.BomChangeLog.is_deleted.is_(False))
    )
    bom_archived = await db.scalar(
        select(func.count(models.BomChangeLog.id)).where(models.BomChangeLog.is_deleted.is_(True))
    )

    inv_active = await db.scalar(
        select(func.count(models.InventoryChangeLog.id)).where(models.InventoryChangeLog.is_deleted.is_(False))
    )
    inv_archived = await db.scalar(
        select(func.count(models.InventoryChangeLog.id)).where(models.InventoryChangeLog.is_deleted.is_(True))
    )
    audit_active = await db.scalar(
        select(func.count(models.AuditLog.id)).where(models.AuditLog.is_deleted.is_(False))
    )
    audit_archived = await db.scalar(
        select(func.count(models.AuditLog.id)).where(models.AuditLog.is_deleted.is_(True))
    )

    return {
        "active_count": (bom_active or 0) + (inv_active or 0) + (audit_active or 0),
        "archived_count": (bom_archived or 0) + (inv_archived or 0) + (audit_archived or 0),
    }
