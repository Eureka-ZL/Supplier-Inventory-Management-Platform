from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Optional


@dataclass
class InventoryAdjustmentParseResult:
    is_candidate: bool
    change_type: str = "unknown"
    quantity: Optional[float] = None
    unit: Optional[str] = None
    actor_name: Optional[str] = None
    part_no: Optional[str] = None
    part_name: Optional[str] = None
    reason: Optional[str] = None
    confidence: float = 0
    parse_source: str = "rule"
    candidate_reason: Optional[str] = None
    source_excerpt: Optional[str] = None

    def to_record_payload(self) -> Dict[str, Any]:
        return {
            "actor_name": self.actor_name,
            "part_no": self.part_no,
            "part_name": self.part_name,
            "change_type": self.change_type,
            "quantity": self.quantity,
            "unit": self.unit,
            "reason": self.reason,
            "parse_confidence": self.confidence,
            "parse_source": self.parse_source,
            "status": "pending",
        }


@dataclass
class InventoryAdjustmentDraftItem:
    part_no: Optional[str] = None
    part_name: Optional[str] = None
    quantity: Optional[float] = None
    unit: Optional[str] = None
    source_excerpt: Optional[str] = None
