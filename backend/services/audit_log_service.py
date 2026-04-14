import json
from typing import Any, Optional

import models
from sqlalchemy.ext.asyncio import AsyncSession


async def create_audit_log(
    db: AsyncSession,
    *,
    scope: str,
    action: str,
    actor: Optional[str],
    entity_type: str,
    entity_id: Optional[Any] = None,
    title: str,
    summary: Optional[str] = None,
    detail: Optional[dict[str, Any]] = None,
) -> models.AuditLog:
    row = models.AuditLog(
        scope=str(scope or "system"),
        action=str(action or "").strip(),
        actor=str(actor or "").strip() or None,
        entity_type=str(entity_type or "").strip(),
        entity_id=str(entity_id).strip() if entity_id not in (None, "") else None,
        title=str(title or "").strip(),
        summary=str(summary or "").strip() or None,
        detail_json=json.dumps(detail or {}, ensure_ascii=False),
    )
    db.add(row)
    await db.flush()
    return row
