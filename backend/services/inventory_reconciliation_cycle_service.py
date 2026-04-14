from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

import models
from services.audit_log_service import create_audit_log


async def get_latest_reconciliation_cycle(
    db: AsyncSession,
    *,
    status: Optional[str] = None,
) -> Optional[models.InventoryReconciliationCycle]:
    stmt = select(models.InventoryReconciliationCycle)
    if status:
        stmt = stmt.where(models.InventoryReconciliationCycle.status == status)
    stmt = stmt.order_by(
        desc(models.InventoryReconciliationCycle.created_at),
        desc(models.InventoryReconciliationCycle.id),
    ).limit(1)
    result = await db.execute(stmt)
    return result.scalar_one_or_none()


async def ensure_open_reconciliation_cycle(
    db: AsyncSession,
    *,
    base_record: models.InventoryRecord,
    actor: str = "system",
    note: Optional[str] = None,
) -> models.InventoryReconciliationCycle:
    existing_open = await get_latest_reconciliation_cycle(db, status="open")
    if existing_open is not None:
        return existing_open

    cycle = models.InventoryReconciliationCycle(
        base_record_id=int(base_record.id),
        status="open",
        note=note or f"期初库存表：{base_record.file_name or base_record.source_email}",
    )
    db.add(cycle)
    await db.flush()
    await create_audit_log(
        db,
        scope="pmc",
        action="reconciliation_cycle_opened",
        actor=actor,
        entity_type="inventory_reconciliation_cycle",
        entity_id=cycle.id,
        title="库存对账周期已开启",
        summary=f"以库存表 {base_record.file_name or base_record.source_email} 作为期初库存",
        detail={
            "base_record_id": int(base_record.id),
            "base_record_name": base_record.file_name or base_record.source_email,
        },
    )
    return cycle


async def handle_new_inventory_upload(
    db: AsyncSession,
    *,
    new_record: models.InventoryRecord,
    actor: str = "system",
    note: Optional[str] = None,
) -> models.InventoryReconciliationCycle:
    """Called when a new inventory sheet is uploaded/synced.

    Smart routing logic:
    - No open cycle → create new cycle with this sheet as 期初 (base)
    - Open cycle with no closing → set this sheet as 期末 (closing)
    - Open cycle with existing closing → replace the 期末 sheet
    """
    latest_open = await get_latest_reconciliation_cycle(db, status="open")
    record_name = new_record.file_name or new_record.source_email

    if latest_open is None:
        # ── Case 1: No open cycle → create new cycle, sheet = 期初 ──
        new_cycle = models.InventoryReconciliationCycle(
            base_record_id=int(new_record.id),
            status="open",
            note=note or f"期初库存表：{record_name}",
        )
        db.add(new_cycle)
        await db.flush()
        await create_audit_log(
            db,
            scope="pmc",
            action="reconciliation_cycle_opened",
            actor=actor,
            entity_type="inventory_reconciliation_cycle",
            entity_id=new_cycle.id,
            title="新库存对账周期已开启",
            summary=f"以库存表 {record_name} 作为期初库存",
            detail={
                "base_record_id": int(new_record.id),
                "base_record_name": record_name,
            },
        )
        return new_cycle

    # Skip if same record is already set
    if int(latest_open.base_record_id) == int(new_record.id):
        return latest_open
    if latest_open.closing_record_id and int(latest_open.closing_record_id) == int(new_record.id):
        return latest_open

    if latest_open.closing_record_id is None:
        # ── Case 2: Open cycle, no closing → sheet = 期末 ──
        latest_open.closing_record_id = int(new_record.id)
        latest_open.updated_at = datetime.utcnow()
        await db.flush()
        await create_audit_log(
            db,
            scope="pmc",
            action="reconciliation_cycle_closing_set",
            actor=actor,
            entity_type="inventory_reconciliation_cycle",
            entity_id=latest_open.id,
            title="期末库存表已设置",
            summary=f"期末库存表已设置为 {record_name}，可以开始对账",
            detail={
                "cycle_id": int(latest_open.id),
                "base_record_id": int(latest_open.base_record_id),
                "closing_record_id": int(new_record.id),
                "closing_record_name": record_name,
            },
        )
        return latest_open

    # ── Case 3: Open cycle, already has closing → replace closing ──
    old_closing_record_id = int(latest_open.closing_record_id)
    latest_open.closing_record_id = int(new_record.id)
    latest_open.updated_at = datetime.utcnow()
    await db.flush()
    await create_audit_log(
        db,
        scope="pmc",
        action="reconciliation_cycle_closing_updated",
        actor=actor,
        entity_type="inventory_reconciliation_cycle",
        entity_id=latest_open.id,
        title="期末库存表已更新",
        summary=f"期末库存表已更新为 {record_name}",
        detail={
            "cycle_id": int(latest_open.id),
            "old_closing_record_id": old_closing_record_id,
            "new_closing_record_id": int(new_record.id),
            "new_closing_record_name": record_name,
        },
    )
    return latest_open


async def lock_reconciliation_cycle(
    db: AsyncSession,
    *,
    closing_record_id: int,
    actor: str = "system",
    note: Optional[str] = None,
) -> tuple[models.InventoryReconciliationCycle, models.InventoryReconciliationCycle]:
    """User-initiated action to lock the current open cycle.

    The user explicitly selects which inventory record to use as the
    closing (期末) record, completing the reconciliation cycle.

    Returns a tuple of (locked_cycle, new_open_cycle).
    """
    latest_open = await get_latest_reconciliation_cycle(db, status="open")
    if latest_open is None:
        raise ValueError("当前没有处于开启状态的对账周期")

    if int(latest_open.base_record_id) == closing_record_id:
        raise ValueError("期末库存表不能和期初库存表相同")

    # Load the closing record to get its name for audit logs
    result = await db.execute(
        select(models.InventoryRecord).where(models.InventoryRecord.id == closing_record_id)
    )
    closing_record = result.scalar_one_or_none()
    if closing_record is None:
        raise ValueError(f"期末库存表不存在: id={closing_record_id}")

    # Lock the current cycle
    latest_open.closing_record_id = closing_record_id
    latest_open.status = "locked"
    latest_open.locked_at = datetime.utcnow()
    latest_open.locked_by = actor
    latest_open.updated_at = datetime.utcnow()
    if note:
        latest_open.note = (latest_open.note or "") + f"\n锁定备注：{note}"
    await db.flush()

    await create_audit_log(
        db,
        scope="pmc",
        action="reconciliation_cycle_locked",
        actor=actor,
        entity_type="inventory_reconciliation_cycle",
        entity_id=latest_open.id,
        title="库存对账周期已锁定",
        summary=f"期末库存表已更新为 {closing_record.file_name or closing_record.source_email}",
        detail={
            "cycle_id": int(latest_open.id),
            "base_record_id": int(latest_open.base_record_id),
            "closing_record_id": closing_record_id,
            "closing_record_name": closing_record.file_name or closing_record.source_email,
        },
    )

    # Automatically open a new cycle with the closing record as the new base
    new_cycle = models.InventoryReconciliationCycle(
        base_record_id=closing_record_id,
        status="open",
        note=f"期初库存表：{closing_record.file_name or closing_record.source_email}",
    )
    db.add(new_cycle)
    await db.flush()
    await create_audit_log(
        db,
        scope="pmc",
        action="reconciliation_cycle_opened",
        actor=actor,
        entity_type="inventory_reconciliation_cycle",
        entity_id=new_cycle.id,
        title="新库存对账周期已开启",
        summary=f"以库存表 {closing_record.file_name or closing_record.source_email} 作为新周期期初库存",
        detail={
            "base_record_id": closing_record_id,
            "base_record_name": closing_record.file_name or closing_record.source_email,
            "previous_cycle_id": int(latest_open.id),
        },
    )

    return latest_open, new_cycle
