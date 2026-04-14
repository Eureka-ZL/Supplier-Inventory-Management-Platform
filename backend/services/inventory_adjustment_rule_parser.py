from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

from config import settings
from services.inventory_adjustment_types import (
    InventoryAdjustmentDraftItem,
    InventoryAdjustmentParseResult,
)


CHANGE_KEYWORDS: Dict[str, tuple[str, ...]] = {
    "outbound": ("取走", "领用", "領用", "领取", "領取", "需领", "需領", "借出", "拿走", "发出", "發出"),
    "return": ("归还", "歸還", "退回", "还回", "還回", "返还", "返還"),
    "inbound": ("入库", "入庫", "补回", "補回", "补入", "補入", "收到"),
    "scrap": ("报废", "報廢", "损耗", "損耗", "报损", "報損"),
}

REQUEST_INTENT_KEYWORDS: Dict[str, tuple[str, ...]] = {
    "outbound": (
        "申请领取物料",
        "申請領取物料",
        "物料申请领取",
        "物料申請領取",
        "维修物料申请领取",
        "維修物料申請領取",
        "申请领取",
        "申請領取",
        "申请领料",
        "申請領料",
        "申请领用",
        "申請領用",
        "领料申请",
        "領料申請",
        "需领用此物料",
        "需領用此物料",
        "需领以下物料",
        "需領以下物料",
        "需领用",
        "需領用",
        "需领取",
        "需領取",
    ),
    "return": (
        "申请归还",
        "申請歸還",
        "归还物料",
        "歸還物料",
        "退回物料",
        "返还物料",
        "返還物料",
        "需归还",
        "需歸還",
    ),
    "inbound": (
        "申请入库",
        "申請入庫",
        "补料入库",
        "補料入庫",
        "补入物料",
        "補入物料",
        "新增物料",
        "需入库",
        "需入庫",
    ),
    "scrap": (
        "申请报废",
        "申請報廢",
        "报废物料",
        "報廢物料",
        "需报废",
        "需報廢",
        "报损申请",
        "報損申請",
    ),
}

ACTOR_LABELS = ("人员", "人員", "操作人", "领用人", "領用人", "借用人", "归还人", "歸還人", "申请人", "申請人")
PART_NO_LABELS = ("物料编码", "物料編碼", "物料编号", "物料編號", "料号", "料號", "编码", "編碼", "物料", "part no", "pn")
PART_NAME_LABELS = ("物料名称", "物料名稱", "品名", "名称", "名稱")
ACTOR_STOPWORDS = {"需", "请", "請", "烦请", "煩請", "麻烦", "麻煩", "直接", "尽快", "儘快", "协助", "協助"}


def parse_inventory_adjustment_email(
    sender: str,
    subject: str,
    body_text: str,
) -> InventoryAdjustmentParseResult:
    items = parse_inventory_adjustment_email_items(sender=sender, subject=subject, body_text=body_text)
    if items:
        return items[0]

    latest_body = _extract_latest_email_segment(body_text)
    sender_value = (sender or "").strip().lower()
    subject_value = (subject or "").strip()
    body_value = latest_body.strip()
    merged_text = "\n".join(item for item in [subject_value, body_value] if item)

    if not merged_text:
        return InventoryAdjustmentParseResult(
            is_candidate=False,
            candidate_reason="邮件正文为空，无法判断是否为库存异动邮件",
        )

    sender_whitelist = settings.pmc_inventory_adjustment_senders_list
    subject_keywords = settings.pmc_inventory_adjustment_subject_keywords_list

    sender_matched = not sender_whitelist or any(item in sender_value for item in sender_whitelist)
    subject_matched = any(keyword in subject_value for keyword in subject_keywords)
    change_type = _extract_change_type(merged_text)
    request_intent_matched = _has_inventory_request_intent(
        subject_text=subject_value,
        body_text=body_value,
        change_type=change_type,
    )
    material_context_matched = _has_material_context(body_value)

    if not sender_matched and not subject_matched and change_type == "unknown":
        return InventoryAdjustmentParseResult(
            is_candidate=False,
            candidate_reason="未命中发件人白名单、主题关键词或库存异动动作词",
        )

    quantity, unit = _extract_quantity_and_unit(subject_value, body_value, change_type)
    actor_name = _extract_by_labels(merged_text, ACTOR_LABELS) or _extract_actor_by_action(merged_text)
    part_no = _extract_by_labels(merged_text, PART_NO_LABELS) or _extract_part_no_from_free_text(merged_text)
    part_name = _extract_by_labels(merged_text, PART_NAME_LABELS)
    reason = _extract_reason(change_type)

    confidence = 0.25
    if sender_matched:
        confidence += 0.15
    if subject_matched:
        confidence += 0.2
    if change_type != "unknown":
        confidence += 0.2
    if quantity is not None:
        confidence += 0.1
    if actor_name:
        confidence += 0.05
    if part_no:
        confidence += 0.15
    if part_name:
        confidence += 0.05

    is_candidate = (
        quantity is not None
        and _is_high_confidence_inventory_request_email(
            subject_text=subject_value,
            body_text=body_value,
            change_type=change_type,
            material_context_matched=material_context_matched,
            request_intent_matched=request_intent_matched,
        )
    )

    if not is_candidate:
        return InventoryAdjustmentParseResult(
            is_candidate=False,
            change_type=change_type,
            quantity=quantity,
            unit=unit,
            actor_name=actor_name,
            part_no=part_no,
            part_name=part_name,
            reason=reason,
            confidence=min(confidence, 0.6),
            candidate_reason="缺少明确申请意图、动作词或数量，先不进入库存异动处理",
        )

    return InventoryAdjustmentParseResult(
        is_candidate=True,
        change_type=change_type,
        quantity=quantity,
        unit=unit,
        actor_name=actor_name,
        part_no=part_no,
        part_name=part_name,
        reason=reason,
        confidence=min(confidence, 0.95),
        candidate_reason="命中库存异动规则",
    )


def parse_inventory_adjustment_email_items(
    sender: str,
    subject: str,
    body_text: str,
) -> List[InventoryAdjustmentParseResult]:
    latest_body = _extract_latest_email_segment(body_text)
    sender_value = (sender or "").strip().lower()
    subject_value = (subject or "").strip()
    merged_text = "\n".join(item for item in [subject_value, latest_body] if item)

    if not merged_text.strip():
        return []

    sender_whitelist = settings.pmc_inventory_adjustment_senders_list
    subject_keywords = settings.pmc_inventory_adjustment_subject_keywords_list
    sender_matched = not sender_whitelist or any(item in sender_value for item in sender_whitelist)
    subject_matched = any(keyword in subject_value for keyword in subject_keywords)
    change_type = _extract_change_type(merged_text)
    material_context_matched = _has_material_context(latest_body)
    request_intent_matched = _has_inventory_request_intent(
        subject_text=subject_value,
        body_text=latest_body,
        change_type=change_type,
    )

    if not sender_matched and not subject_matched and change_type == "unknown":
        return []
    if not _is_high_confidence_inventory_request_email(
        subject_text=subject_value,
        body_text=latest_body,
        change_type=change_type,
        material_context_matched=material_context_matched,
        request_intent_matched=request_intent_matched,
    ):
        return []

    actor_name = _extract_by_labels(merged_text, ACTOR_LABELS) or _extract_actor_by_action(merged_text)
    reason = _extract_reason(change_type)
    draft_items = _extract_draft_items(subject_value=subject_value, body_text=latest_body)
    results: List[InventoryAdjustmentParseResult] = []

    for draft in draft_items:
        if draft.quantity is None or (not draft.part_no and not draft.part_name):
            continue

        confidence = 0.3
        if sender_matched:
            confidence += 0.1
        if subject_matched:
            confidence += 0.15
        if change_type != "unknown":
            confidence += 0.2
        if actor_name:
            confidence += 0.05
        if draft.part_no:
            confidence += 0.1
        if draft.part_name:
            confidence += 0.05
        if draft.unit:
            confidence += 0.05

        results.append(
            InventoryAdjustmentParseResult(
                is_candidate=change_type != "unknown",
                change_type=change_type,
                quantity=draft.quantity,
                unit=draft.unit,
                actor_name=actor_name,
                part_no=draft.part_no,
                part_name=draft.part_name,
                reason=reason,
                confidence=min(confidence, 0.95),
                parse_source="rule",
                candidate_reason="命中库存异动规则",
                source_excerpt=draft.source_excerpt,
            )
        )

    return results


def _extract_change_type(text: str) -> str:
    value = text or ""
    for change_type, keywords in CHANGE_KEYWORDS.items():
        if any(keyword in value for keyword in keywords):
            return change_type
    return "unknown"


def _normalize_ai_change_type(value: Any) -> str:
    raw = str(value or "").strip().lower()
    if raw in {"outbound", "return", "inbound", "scrap"}:
        return raw
    alias_map = {
        "出库": "outbound",
        "领用": "outbound",
        "領用": "outbound",
        "领取": "outbound",
        "領取": "outbound",
        "归还": "return",
        "歸還": "return",
        "入库": "inbound",
        "入庫": "inbound",
        "报废": "scrap",
        "報廢": "scrap",
    }
    return alias_map.get(str(value or "").strip(), "unknown")


def _extract_quantity_and_unit(
    subject_text: str,
    body_text: str,
    change_type: str,
) -> tuple[Optional[float], Optional[str]]:
    labeled_match = re.search(
        r"(?:数量|數量|数目|數目|数量为|數量為)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*(个|pcs|PCS|件|台|套|片|支|箱|ea)?",
        body_text or "",
        flags=re.IGNORECASE,
    )
    if labeled_match:
        return _to_quantity_tuple(labeled_match.group(1), labeled_match.group(2))

    action_pattern = {
        "outbound": r"(?:取走|领用|領用|借出|拿走|发出|發出)",
        "return": r"(?:归还|歸還|退回|还回|還回|返还|返還)",
        "inbound": r"(?:入库|入庫|补回|補回|补入|補入|收到)",
        "scrap": r"(?:报废|報廢|损耗|損耗|报损|報損)",
    }.get(change_type, r"(?:取走|领用|領用|借出|归还|歸還|入库|入庫|报废|報廢)")
    action_match = re.search(
        rf"{action_pattern}[^\d]{{0,8}}(\d+(?:\.\d+)?)\s*(个|pcs|PCS|件|台|套|片|支|箱|ea)",
        "\n".join(item for item in [subject_text, body_text] if item),
        flags=re.IGNORECASE,
    )
    if action_match:
        return _to_quantity_tuple(action_match.group(1), action_match.group(2))

    fallback_match = re.search(
        r"(?<![A-Za-z0-9._/-])(\d+(?:\.\d+)?)\s*(个|pcs|PCS|件|台|套|片|支|箱|ea)\b",
        "\n".join(item for item in [subject_text, body_text] if item),
        flags=re.IGNORECASE,
    )
    if fallback_match:
        return _to_quantity_tuple(fallback_match.group(1), fallback_match.group(2))

    return None, None


def _to_quantity_tuple(raw_quantity: Optional[str], raw_unit: Optional[str]) -> tuple[Optional[float], Optional[str]]:
    if raw_quantity is None:
        return None, None
    try:
        quantity = float(raw_quantity)
    except Exception:
        return None, None
    return quantity, raw_unit


def _extract_by_labels(text: str, labels: tuple[str, ...]) -> Optional[str]:
    value = text or ""
    for label in labels:
        pattern = rf"(?:{re.escape(label)})\s*[:：]?\s*([A-Za-z0-9_\-./()\u4e00-\u9fff]+)"
        match = re.search(pattern, value, flags=re.IGNORECASE)
        if match:
            candidate = match.group(1).strip()
            if labels is PART_NO_LABELS:
                normalized = _extract_part_no_from_free_text(candidate)
                if normalized:
                    return normalized
                continue
            return candidate
    return None


def _extract_actor_by_action(text: str) -> Optional[str]:
    explicit_user_match = re.search(
        r"(用户[A-Za-z0-9_\-\u4e00-\u9fff]+)\s*(?:取走|领用|領用|借出|归还|歸還|入库|入庫|报废|報廢)",
        text or "",
    )
    if explicit_user_match:
        return explicit_user_match.group(1).strip()

    match = re.search(
        r"([A-Za-z0-9_\-\u4e00-\u9fff]+?)\s*(?:取走|领用|領用|借出|归还|歸還|入库|入庫|报废|報廢)",
        text or "",
    )
    if match:
        candidate = match.group(1).strip()
        if candidate not in ACTOR_STOPWORDS and len(candidate) >= 2:
            return candidate
    return None


def _extract_part_no_from_free_text(text: str) -> Optional[str]:
    for match in re.finditer(r"\b([A-Z0-9][A-Z0-9._/-]{3,})\b", text or ""):
        candidate = match.group(1).strip()
        digit_count = sum(1 for ch in candidate if ch.isdigit())
        alpha_count = sum(1 for ch in candidate if ch.isalpha())
        if candidate.lower().endswith(("pcs", "ea")):
            continue
        if candidate.isdigit():
            if len(candidate) >= 8:
                return candidate
            continue
        if digit_count >= 3 and (alpha_count > 0 or any(ch in candidate for ch in "-_/.")):
            return candidate
    return None


def _has_material_context(body_text: str) -> bool:
    value = body_text or ""
    if not value.strip():
        return False
    if any(label in value for label in PART_NO_LABELS):
        return True
    if any(label in value for label in PART_NAME_LABELS):
        return True
    return _extract_part_no_from_free_text(value) is not None


def _has_inventory_request_intent(subject_text: str, body_text: str, change_type: str) -> bool:
    if change_type == "unknown":
        return False

    subject_value = subject_text or ""
    body_value = body_text or ""
    merged_value = "\n".join(item for item in [subject_value, body_value] if item).strip()
    if not merged_value:
        return False

    type_keywords = REQUEST_INTENT_KEYWORDS.get(change_type, ())
    if any(keyword in merged_value for keyword in type_keywords):
        return True

    if change_type == "outbound":
        if re.search(r"(申请|申請|需|烦请|煩請|麻烦|麻煩|请协助|請協助).{0,12}(领取|領取|领用|領用|领料|領料)", merged_value):
            return True
        if _has_labeled_material_and_quantity(body_value) and re.search(r"(申请|申請|需|烦请|煩請|麻烦|麻煩|请协助|請協助)", merged_value):
            return True
        return False

    if change_type == "return":
        return re.search(r"(申请|申請|需|烦请|煩請|麻烦|麻煩|请协助|請協助).{0,12}(归还|歸還|退回|返还|返還)", merged_value) is not None

    if change_type == "inbound":
        return re.search(r"(申请|申請|需|烦请|煩請|麻烦|麻煩|请协助|請協助).{0,12}(入库|入庫|补入|補入|补回|補回|新增)", merged_value) is not None

    if change_type == "scrap":
        return re.search(r"(申请|申請|需|烦请|煩請|麻烦|麻煩|请协助|請協助).{0,12}(报废|報廢|报损|報損|损耗|損耗)", merged_value) is not None

    return False


def _has_labeled_material_and_quantity(text: str) -> bool:
    if not text.strip():
        return False
    material_field_match = re.search(
        r"(?:物料编码|物料編碼|物料编号|物料編號|料号|料號|物料)\s*[:：]\s*([A-Z0-9][A-Z0-9._/-]{5,})",
        text,
        flags=re.IGNORECASE,
    )
    quantity_field_match = re.search(
        r"(?:数量|數量|数目|數目|数量为|數量為)\s*[:：]\s*(\d+(?:\.\d+)?)\s*(个|pcs|PCS|件|台|套|片|支|箱|ea)?",
        text,
        flags=re.IGNORECASE,
    )
    return material_field_match is not None and quantity_field_match is not None


def _is_high_confidence_inventory_request_email(
    subject_text: str,
    body_text: str,
    change_type: str,
    material_context_matched: bool,
    request_intent_matched: bool,
) -> bool:
    if change_type != "outbound":
        return False
    if not material_context_matched or not request_intent_matched:
        return False

    subject_value = subject_text or ""
    body_value = body_text or ""
    merged_value = "\n".join(item for item in [subject_value, body_value] if item)

    strong_request_markers = (
        "申请领取物料",
        "申請領取物料",
        "物料申请领取",
        "物料申請領取",
        "维修物料申请领取",
        "維修物料申請領取",
        "申请领料",
        "申請領料",
        "申请领用",
        "申請領用",
        "领料申请",
        "領料申請",
    )
    if any(marker in merged_value for marker in strong_request_markers):
        return _has_labeled_material_and_quantity(body_value)

    return False


def _extract_reason(change_type: str) -> Optional[str]:
    if change_type == "outbound":
        return "邮件正文识别为领用/取走类异动"
    if change_type == "return":
        return "邮件正文识别为归还类异动"
    if change_type == "inbound":
        return "邮件正文识别为入库类异动"
    if change_type == "scrap":
        return "邮件正文识别为报废/损耗类异动"
    return None


def _extract_latest_email_segment(body_text: str) -> str:
    value = (body_text or "").strip()
    if not value:
        return ""
    patterns = [
        r"(?mi)^On .+ wrote:\s*$",
        r"(?mi)^>+\s*On .+ wrote:\s*$",
        r"(?mi)^\d{4}[/-]\d{1,2}[/-]\d{1,2}.+wrote:\s*$",
        r"(?mi)^\d{4}年\d{1,2}月\d{1,2}日.*写道[:：]\s*$",
        r"(?mi)^在.*写道[:：]\s*$",
        r"(?mi)^发件人[:：].*$",
        r"(?mi)^From:\s.*$",
        r"(?mi)^-----Original Message-----$",
        r"(?mi)^[- ]*Forwarded message[- ]*$",
        r"(?mi)^>+.*$",
    ]
    cutoff = len(value)
    for pattern in patterns:
        match = re.search(pattern, value)
        if match:
            cutoff = min(cutoff, match.start())
    return value[:cutoff].strip()


def _extract_draft_items(subject_value: str, body_text: str) -> List[InventoryAdjustmentDraftItem]:
    candidates: List[InventoryAdjustmentDraftItem] = []
    candidates.extend(_extract_labeled_items(body_text))
    candidates.extend(_extract_semicolon_items(body_text))
    candidates.extend(_extract_table_items(body_text))
    candidates.extend(_extract_inline_items(subject_value, body_text))
    return _dedupe_draft_items(candidates)


def _extract_labeled_items(body_text: str) -> List[InventoryAdjustmentDraftItem]:
    lines = [line.strip() for line in (body_text or "").splitlines()]
    items: List[InventoryAdjustmentDraftItem] = []
    pending_part_no: Optional[str] = None
    pending_part_name: Optional[str] = None

    for line in lines:
        if not line:
            continue

        part_no = _extract_by_labels(line, PART_NO_LABELS)
        part_name = _extract_by_labels(line, PART_NAME_LABELS)
        quantity, unit = _extract_quantity_and_unit("", line, "unknown")

        if part_no:
            pending_part_no = part_no
        if part_name:
            pending_part_name = part_name

        if quantity is not None and (pending_part_no or pending_part_name):
            items.append(
                InventoryAdjustmentDraftItem(
                    part_no=pending_part_no,
                    part_name=pending_part_name,
                    quantity=quantity,
                    unit=unit,
                    source_excerpt=" ".join(
                        part for part in [pending_part_no or pending_part_name or "", line] if part
                    ).strip(),
                )
            )
            pending_part_no = None
            pending_part_name = None

    return items


def _extract_semicolon_items(body_text: str) -> List[InventoryAdjustmentDraftItem]:
    items: List[InventoryAdjustmentDraftItem] = []
    for raw_line in (body_text or "").splitlines():
        line = raw_line.strip()
        if line.count(";") < 2:
            continue
        parts = [part.strip() for part in line.split(";") if part.strip()]
        if len(parts) < 3:
            continue
        part_no = _extract_part_no_from_free_text(parts[0])
        quantity, unit = _extract_quantity_and_unit("", parts[-1], "unknown")
        if part_no and quantity is not None:
            items.append(
                InventoryAdjustmentDraftItem(
                    part_no=part_no,
                    part_name=parts[1] if len(parts) >= 2 else None,
                    quantity=quantity,
                    unit=unit,
                    source_excerpt=line,
                )
            )
    return items


def _extract_table_items(body_text: str) -> List[InventoryAdjustmentDraftItem]:
    items: List[InventoryAdjustmentDraftItem] = []
    for raw_line in (body_text or "").splitlines():
        line = raw_line.strip()
        if not line or not re.match(r"^\d+\s+", line):
            continue

        columns = [segment.strip() for segment in re.split(r"\t+|\s{2,}", line) if segment.strip()]
        if len(columns) < 3:
            continue

        part_no = None
        for column in columns:
            candidate = _extract_part_no_from_free_text(column)
            if candidate:
                part_no = candidate
                break
        if not part_no:
            continue

        quantity = None
        unit = None
        for column in reversed(columns):
            quantity, unit = _extract_quantity_and_unit("", column, "unknown")
            if quantity is not None:
                break
            plain_numeric = re.fullmatch(r"(\d+(?:\.\d+)?)", column)
            if plain_numeric:
                quantity = float(plain_numeric.group(1))
                unit = None
                break
        if quantity is None:
            continue

        part_name = None
        if len(columns) >= 3:
            try:
                part_index = columns.index(part_no)
            except ValueError:
                part_index = 1
            if part_index + 1 < len(columns):
                part_name = columns[part_index + 1]

        items.append(
            InventoryAdjustmentDraftItem(
                part_no=part_no,
                part_name=part_name,
                quantity=quantity,
                unit=unit,
                source_excerpt=line,
            )
        )
    return items


def _extract_inline_items(subject_value: str, body_text: str) -> List[InventoryAdjustmentDraftItem]:
    lines = [line.strip() for line in (body_text or "").splitlines() if line.strip()]
    items: List[InventoryAdjustmentDraftItem] = []

    for index, line in enumerate(lines):
        part_no = _extract_part_no_from_free_text(line)
        quantity, unit = _extract_quantity_and_unit("", line, "unknown")
        if part_no and quantity is not None:
            items.append(
                InventoryAdjustmentDraftItem(
                    part_no=part_no,
                    quantity=quantity,
                    unit=unit,
                    source_excerpt=line,
                )
            )
            continue

        if part_no and quantity is None:
            lookahead_lines = [line]
            if index + 1 < len(lines):
                lookahead_lines.append(lines[index + 1])
            if index + 2 < len(lines):
                lookahead_lines.append(lines[index + 2])
            merged = " ".join(lookahead_lines)
            quantity, unit = _extract_quantity_and_unit("", merged, "unknown")
            if quantity is not None:
                items.append(
                    InventoryAdjustmentDraftItem(
                        part_no=part_no,
                        quantity=quantity,
                        unit=unit,
                        source_excerpt=merged,
                    )
                )

    return items


def _dedupe_draft_items(items: List[InventoryAdjustmentDraftItem]) -> List[InventoryAdjustmentDraftItem]:
    deduped_map: Dict[tuple[str, float, str], InventoryAdjustmentDraftItem] = {}
    for item in items:
        key = (
            str(item.part_no or item.part_name or "").strip().upper(),
            float(item.quantity or 0),
            str(item.unit or "").strip().lower(),
        )
        existing = deduped_map.get(key)
        if existing is None:
            deduped_map[key] = item
            continue
        if not existing.part_name and item.part_name:
            existing.part_name = item.part_name
        if not existing.part_no and item.part_no:
            existing.part_no = item.part_no
        if not existing.source_excerpt and item.source_excerpt:
            existing.source_excerpt = item.source_excerpt
    return list(deduped_map.values())


def _dedupe_parse_results(items: List[InventoryAdjustmentParseResult]) -> List[InventoryAdjustmentParseResult]:
    deduped_map: Dict[tuple[str, float, str, str], InventoryAdjustmentParseResult] = {}
    for item in items:
        key = (
            str(item.part_no or item.part_name or "").strip().upper(),
            float(item.quantity or 0),
            str(item.unit or "").strip().lower(),
            str(item.change_type or "").strip().lower(),
        )
        existing = deduped_map.get(key)
        if existing is None:
            deduped_map[key] = item
            continue
        if not existing.part_name and item.part_name:
            existing.part_name = item.part_name
        if not existing.part_no and item.part_no:
            existing.part_no = item.part_no
        if not existing.actor_name and item.actor_name:
            existing.actor_name = item.actor_name
        if (item.confidence or 0) > (existing.confidence or 0):
            existing.confidence = item.confidence
            existing.source_excerpt = item.source_excerpt or existing.source_excerpt
            existing.reason = item.reason or existing.reason
    return list(deduped_map.values())
