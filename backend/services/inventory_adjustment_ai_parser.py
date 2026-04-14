from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

from config import settings
from services.ai_completion_service import AICompletionError, chat_completion_json
from services.inventory_adjustment_rule_parser import (
    _dedupe_parse_results,
    _extract_latest_email_segment,
    _extract_part_no_from_free_text,
    _extract_reason,
    _has_labeled_material_and_quantity,
    _normalize_ai_change_type,
)
from services.inventory_adjustment_types import InventoryAdjustmentParseResult


AI_DIRECT_REQUEST_MARKERS = (
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
    "需领用此物料",
    "需領用此物料",
)

AI_BLOCKLIST_KEYWORDS = (
    "更换问题", "更換問題", "更换", "更換", "问题", "問題",
    "颜色差异", "顏色差異", "色差", "补色", "補色",
    "返工", "包装", "包裝", "处理通知", "處理通知",
    "出货", "出貨", "异常说明", "異常說明",
)


async def parse_inventory_adjustment_email_items_with_ai(
    sender: str,
    subject: str,
    body_text: str,
) -> List[InventoryAdjustmentParseResult]:
    if not settings.PMC_INVENTORY_ADJUSTMENT_AI_ENABLED:
        return []

    latest_body = _extract_latest_email_segment(body_text)
    subject_value = (subject or "").strip()
    sender_value = (sender or "").strip()
    if not _should_try_ai_inventory_parse(subject_value, latest_body):
        return []

    parsed = await _request_ai_inventory_adjustment_parse(
        sender=sender_value,
        subject=subject_value,
        body_text=latest_body,
    )
    if not parsed.get("is_inventory_adjustment"):
        return []

    items = parsed.get("items")
    if not isinstance(items, list):
        return []

    results: List[InventoryAdjustmentParseResult] = []
    for raw_item in items:
        if not isinstance(raw_item, dict):
            continue

        change_type = _normalize_ai_change_type(raw_item.get("change_type"))
        if change_type == "unknown":
            continue

        quantity = _to_float(raw_item.get("quantity"))
        if quantity is None or quantity <= 0:
            continue

        part_no = _extract_part_no_from_free_text(str(raw_item.get("part_no") or "").strip())
        part_name = str(raw_item.get("part_name") or "").strip() or None
        if not part_no and not part_name:
            continue

        raw_confidence = _to_float(raw_item.get("confidence"))
        confidence = min(max(raw_confidence if raw_confidence is not None else 0.72, 0.0), 0.98)
        unit = str(raw_item.get("unit") or "").strip() or None
        actor_name = str(raw_item.get("actor_name") or "").strip() or None
        reason = str(raw_item.get("reason") or "").strip() or _extract_reason(change_type)
        source_excerpt = str(raw_item.get("source_excerpt") or "").strip() or None

        results.append(
            InventoryAdjustmentParseResult(
                is_candidate=True,
                change_type=change_type,
                quantity=float(quantity),
                unit=unit,
                actor_name=actor_name,
                part_no=part_no,
                part_name=part_name,
                reason=reason,
                confidence=confidence,
                parse_source="ai",
                candidate_reason="AI 识别为库存异动邮件",
                source_excerpt=source_excerpt,
            )
        )

    return _dedupe_parse_results(results)


def _should_try_ai_inventory_parse(subject_text: str, body_text: str) -> bool:
    merged_value = "\n".join(item for item in [subject_text, body_text] if item).strip()
    if not merged_value:
        return False

    has_direct_request_marker = any(keyword in merged_value for keyword in AI_DIRECT_REQUEST_MARKERS)
    has_direct_request_pattern = re.search(
        r"(申请|申請).{0,8}(领取物料|領取物料|领料|領料|领用|領用)",
        merged_value,
    ) is not None
    if not has_direct_request_marker and not has_direct_request_pattern:
        return False

    if any(keyword in merged_value for keyword in AI_BLOCKLIST_KEYWORDS):
        return False

    return _has_labeled_material_and_quantity(merged_value)


async def _request_ai_inventory_adjustment_parse(
    *,
    sender: str,
    subject: str,
    body_text: str,
) -> Dict[str, Any]:
    system_prompt = """
你是供应链 PMC 邮件解析助手。
你的任务是严格判断一封邮件是否属于“库存异动邮件”，并提取结构化字段。

只把这种情况判定为库存异动邮件：
1. 明确、直接的领料申请邮件
2. 邮件里清楚写了“申请领取物料/申请领料/申请领用/需领用此物料”之类的申请语义
3. 邮件正文里明确有“物料:”和“数量:”字段

不要把以下内容判成库存异动邮件：
1. 计划通知、包装通知、返工通知、排产通知
2. 单纯抄送、确认、沟通、提醒
3. 只提到料号或数量，但没有明确库存动作和申请语义
4. 物料更换问题、颜色差异、补色、换料、异常说明
5. 任何“处理通知”“问题沟通”“物料替换说明”

你必须返回 JSON 对象，格式如下：
{
  "is_inventory_adjustment": true,
  "reason": "一句话判断理由",
  "items": [
    {
      "part_no": "物料编码，没有则空字符串",
      "part_name": "物料名称，没有则空字符串",
      "quantity": 50,
      "unit": "pcs",
      "actor_name": "申请人，没有则空字符串",
      "change_type": "outbound|return|inbound|scrap",
      "reason": "用途或说明，没有则空字符串",
      "source_excerpt": "直接摘录邮件中触发判断的关键片段",
      "confidence": 0.86
    }
  ]
}

如果不是这种“直接领料申请邮件”，返回：
{
  "is_inventory_adjustment": false,
  "reason": "一句话说明",
  "items": []
}

如果你不确定，宁可返回 false。
""".strip()

    user_prompt = f"""
请判断下面这封邮件是否属于库存异动邮件，并提取结构化结果。

发件人:
{sender}

主题:
{subject}

最新邮件正文:
{body_text[:6000]}
""".strip()

    try:
        result = await chat_completion_json(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            temperature=0.1,
            timeout=45.0,
        )
        return result if isinstance(result, dict) else {}
    except AICompletionError:
        return {}


def _to_float(value: Any) -> Optional[float]:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except Exception:
        return None
