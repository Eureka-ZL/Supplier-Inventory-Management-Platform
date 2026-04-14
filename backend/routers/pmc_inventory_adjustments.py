from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

import models
import schemas
from database import get_db
from routers.auth import get_current_user
from services.gmail_service import GmailService
from services.audit_log_service import create_audit_log
from services.inventory_adjustment_runtime_service import (
    apply_inventory_adjustment_event,
    delete_inventory_adjustment_event,
    get_inventory_adjustment_cycle_summary,
    scan_inventory_adjustment_emails,
)

router = APIRouter(prefix="/api/pmc", tags=["PMC Inventory"])


def _ensure_adjustment_access(current_user: models.User, detail: str) -> None:
    if current_user.role not in [models.UserRole.PMC, models.UserRole.ADMIN]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=detail,
        )


async def _get_adjustment_event_or_404(db: AsyncSession, event_id: int) -> models.InventoryAdjustmentEvent:
    result = await db.execute(
        select(models.InventoryAdjustmentEvent).where(
            models.InventoryAdjustmentEvent.id == event_id
        )
    )
    event = result.scalar_one_or_none()
    if event is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="库存异动事件不存在"
        )
    return event


@router.get("/inventory-adjustments", response_model=List[schemas.InventoryAdjustmentEventResponse])
async def get_inventory_adjustment_events(
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    _ensure_adjustment_access(current_user, "Not authorized to access inventory adjustment events")

    result = await db.execute(
        select(models.InventoryAdjustmentEvent)
        .order_by(
            desc(models.InventoryAdjustmentEvent.created_at),
            desc(models.InventoryAdjustmentEvent.id),
        )
    )

    return result.scalars().all()


@router.post("/inventory-adjustments/scan")
async def scan_inventory_adjustment_event_emails(
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    _ensure_adjustment_access(current_user, "Not authorized to scan inventory adjustment emails")

    gmail = GmailService()
    if not gmail.is_ready():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Gmail 尚未授权，请先完成邮箱授权"
        )

    return await scan_inventory_adjustment_emails(db=db, gmail_service=gmail)


@router.get("/inventory-adjustments/summary", response_model=schemas.InventoryAdjustmentCycleSummaryResponse)
async def get_inventory_adjustment_summary(
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _ensure_adjustment_access(current_user, "Not authorized to access inventory adjustment summary")

    try:
        return await get_inventory_adjustment_cycle_summary(db=db)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc


@router.post("/inventory-adjustments/apply")
async def apply_inventory_adjustment(
    request: schemas.InventoryAdjustmentApplyRequest,
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _ensure_adjustment_access(current_user, "Not authorized to apply inventory adjustment events")

    event = await _get_adjustment_event_or_404(db, request.event_id)
    if event.status == "applied":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="该邮件库存变动已经确认过了"
        )

    try:
        return await apply_inventory_adjustment_event(
            db=db,
            event=event,
            operator_name=str(getattr(current_user, "username", "") or "pmc"),
            requested_part_no=request.part_no,
            requested_quantity=request.quantity,
            apply_note=request.apply_note,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc


@router.post("/inventory-adjustments/reject")
async def reject_inventory_adjustment(
    request: schemas.InventoryAdjustmentRejectRequest,
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _ensure_adjustment_access(current_user, "Not authorized to reject inventory adjustment events")

    event = await _get_adjustment_event_or_404(db, request.event_id)
    if event.status == "applied":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="该邮件库存变动已经确认，不能再移除"
        )

    event.status = "rejected"
    event.apply_note = request.apply_note or event.apply_note
    event.rejected_at = func.now()
    event.updated_at = func.now()
    await create_audit_log(
        db,
        scope="pmc",
        action="inventory_adjustment_rejected",
        actor=str(getattr(current_user, "username", "") or "pmc"),
        entity_type="inventory_adjustment_event",
        entity_id=event.id,
        title="邮件库存变动已忽略",
        summary=event.subject or event.matched_part_no or event.part_no or f"事件 #{event.id}",
        detail={
            "event_id": int(event.id),
            "part_no": event.matched_part_no or event.part_no,
            "quantity": float(event.quantity or 0),
            "note": event.apply_note or None,
        },
    )
    await db.commit()
    await db.refresh(event)

    return {
        "success": True,
        "event_id": event.id,
        "status": event.status,
    }


@router.post("/inventory-adjustments/reject/batch")
async def reject_inventory_adjustments_batch(
    request: schemas.InventoryAdjustmentBulkRejectRequest,
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _ensure_adjustment_access(current_user, "Not authorized to reject inventory adjustment events")

    event_ids = sorted({int(event_id) for event_id in request.event_ids if int(event_id) > 0})
    if not event_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="请至少选择一条待移除的邮件库存变动"
        )

    result = await db.execute(
        select(models.InventoryAdjustmentEvent).where(
            models.InventoryAdjustmentEvent.id.in_(event_ids)
        )
    )
    events = list(result.scalars().all())
    if not events:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="未找到要移除的库存异动事件"
        )

    rejected_count = 0
    skipped_applied_count = 0
    for event in events:
        if event.status == "applied":
            skipped_applied_count += 1
            continue
        if event.status == "rejected":
            continue
        event.status = "rejected"
        event.apply_note = request.apply_note or event.apply_note
        event.rejected_at = func.now()
        event.updated_at = func.now()
        await create_audit_log(
            db,
            scope="pmc",
            action="inventory_adjustment_rejected",
            actor=str(getattr(current_user, "username", "") or "pmc"),
            entity_type="inventory_adjustment_event",
            entity_id=event.id,
            title="邮件库存变动已忽略",
            summary=event.subject or event.matched_part_no or event.part_no or f"事件 #{event.id}",
            detail={
                "event_id": int(event.id),
                "part_no": event.matched_part_no or event.part_no,
                "quantity": float(event.quantity or 0),
                "note": event.apply_note or None,
                "batch": True,
            },
        )
        rejected_count += 1

    await db.commit()

    return {
        "success": True,
        "rejected_count": rejected_count,
        "skipped_applied_count": skipped_applied_count,
    }


@router.post("/inventory-adjustments/restore")
async def restore_inventory_adjustment(
    request: schemas.InventoryAdjustmentRestoreRequest,
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _ensure_adjustment_access(current_user, "Not authorized to restore inventory adjustment events")

    event = await _get_adjustment_event_or_404(db, request.event_id)
    if event.status != "rejected":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="只有已忽略的库存异动才能恢复"
        )

    event.status = "pending"
    event.rejected_at = None
    event.updated_at = func.now()
    await create_audit_log(
        db,
        scope="pmc",
        action="inventory_adjustment_restored",
        actor=str(getattr(current_user, "username", "") or "pmc"),
        entity_type="inventory_adjustment_event",
        entity_id=event.id,
        title="邮件库存变动已恢复",
        summary=event.subject or event.matched_part_no or event.part_no or f"事件 #{event.id}",
        detail={
            "event_id": int(event.id),
            "part_no": event.matched_part_no or event.part_no,
            "quantity": float(event.quantity or 0),
        },
    )
    await db.commit()
    await db.refresh(event)

    return {
        "success": True,
        "event_id": event.id,
        "status": event.status,
    }


@router.post("/inventory-adjustments/restore/batch")
async def restore_inventory_adjustments_batch(
    request: schemas.InventoryAdjustmentBulkRestoreRequest,
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _ensure_adjustment_access(current_user, "Not authorized to restore inventory adjustment events")

    event_ids = sorted({int(event_id) for event_id in request.event_ids if int(event_id) > 0})
    if not event_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="请至少选择一条要恢复的邮件库存变动"
        )

    result = await db.execute(
        select(models.InventoryAdjustmentEvent).where(
            models.InventoryAdjustmentEvent.id.in_(event_ids)
        )
    )
    events = list(result.scalars().all())
    if not events:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="未找到要恢复的库存异动事件"
        )

    restored_count = 0
    for event in events:
        if event.status != "rejected":
            continue
        event.status = "pending"
        event.rejected_at = None
        event.updated_at = func.now()
        await create_audit_log(
            db,
            scope="pmc",
            action="inventory_adjustment_restored",
            actor=str(getattr(current_user, "username", "") or "pmc"),
            entity_type="inventory_adjustment_event",
            entity_id=event.id,
            title="邮件库存变动已恢复",
            summary=event.subject or event.matched_part_no or event.part_no or f"事件 #{event.id}",
            detail={
                "event_id": int(event.id),
                "part_no": event.matched_part_no or event.part_no,
                "quantity": float(event.quantity or 0),
                "batch": True,
            },
        )
        restored_count += 1

    await db.commit()

    return {
        "success": True,
        "restored_count": restored_count,
    }


@router.delete("/inventory-adjustments/{event_id}")
async def permanently_delete_inventory_adjustment(
    event_id: int,
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _ensure_adjustment_access(current_user, "Not authorized to delete inventory adjustment events")

    event = await _get_adjustment_event_or_404(db, event_id)
    try:
        return await delete_inventory_adjustment_event(
            db=db,
            event=event,
            operator_name=str(getattr(current_user, "username", "") or "pmc"),
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc


@router.post("/inventory-adjustments/delete/batch")
async def permanently_delete_inventory_adjustments_batch(
    request: schemas.InventoryAdjustmentBulkDeleteRequest,
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _ensure_adjustment_access(current_user, "Not authorized to delete inventory adjustment events")

    event_ids = sorted({int(event_id) for event_id in request.event_ids if int(event_id) > 0})
    if not event_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="请至少选择一条要删除的邮件库存变动"
        )

    result = await db.execute(
        select(models.InventoryAdjustmentEvent).where(
            models.InventoryAdjustmentEvent.id.in_(event_ids)
        )
    )
    events = list(result.scalars().all())
    if not events:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="未找到要删除的库存异动事件"
        )

    deleted_count = 0
    for event in events:
        if event.status != "rejected":
            continue
        await create_audit_log(
            db,
            scope="pmc",
            action="inventory_adjustment_deleted",
            actor=str(getattr(current_user, "username", "") or "pmc"),
            entity_type="inventory_adjustment_event",
            entity_id=event.id,
            title="邮件库存变动已删除",
            summary=event.subject or event.matched_part_no or event.part_no or f"事件 #{event.id}",
            detail={
                "event_id": int(event.id),
                "status": event.status,
                "part_no": event.matched_part_no or event.part_no,
                "quantity": float(event.quantity or 0),
                "batch": True,
            },
        )
        await db.delete(event)
        deleted_count += 1

    await db.commit()

    return {
        "success": True,
        "deleted_count": deleted_count,
    }
