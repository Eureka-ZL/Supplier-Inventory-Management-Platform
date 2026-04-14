"""
清理邮件库存变动，或清空整个数据库内容。

模式 1：默认（dry-run）
- 统计所有 status = rejected 的异动事件
- 从当前最新库存快照开始，逆向回滚并删除可安全清理的 status = applied 异动链
- 保留 pending 异动

模式 2：--all
- 预览或清空整个数据库所有业务表内容
- 保留表结构，但会删除所有数据并重置自增 ID

只有传入 --execute 时才会真正执行删除。

用法：
  python3 clear_processed_inventory_adjustments.py
  python3 clear_processed_inventory_adjustments.py --execute
  python3 clear_processed_inventory_adjustments.py --execute --skip-rejected
  python3 clear_processed_inventory_adjustments.py --execute --skip-applied

  python3 clear_processed_inventory_adjustments.py --all
  python3 clear_processed_inventory_adjustments.py --all --execute
"""

from __future__ import annotations

import argparse
import asyncio
from dataclasses import dataclass
from typing import List, Optional

from sqlalchemy import desc, select, text

import models
from database import AsyncSessionLocal, Base, engine
from services.audit_log_service import create_audit_log


@dataclass
class RejectedCleanupItem:
    event_id: int
    subject: str
    sender: str


@dataclass
class AppliedCleanupItem:
    event_id: int
    record_id: int
    previous_record_id: int
    subject: str
    sender: str
    applied_at: Optional[str]
    change_log_count: int


@dataclass
class TableCountItem:
    table_name: str
    row_count: int


async def _load_rejected_events() -> List[RejectedCleanupItem]:
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(models.InventoryAdjustmentEvent)
            .where(models.InventoryAdjustmentEvent.status == "rejected")
            .order_by(
                models.InventoryAdjustmentEvent.rejected_at.desc().nullslast(),
                models.InventoryAdjustmentEvent.id.desc(),
            )
        )
        events = list(result.scalars().all())
        return [
            RejectedCleanupItem(
                event_id=int(event.id),
                subject=str(event.subject or ""),
                sender=str(event.sender or ""),
            )
            for event in events
        ]


async def _load_latest_applied_chain() -> List[AppliedCleanupItem]:
    chain: List[AppliedCleanupItem] = []
    async with AsyncSessionLocal() as session:
        latest_record_result = await session.execute(
            select(models.InventoryRecord)
            .order_by(desc(models.InventoryRecord.parsed_at), desc(models.InventoryRecord.id))
            .limit(1)
        )
        latest_record = latest_record_result.scalar_one_or_none()
        visited_record_ids: set[int] = set()

        while latest_record is not None:
            latest_record_id = int(latest_record.id)
            if latest_record_id in visited_record_ids:
                break
            visited_record_ids.add(latest_record_id)

            event_result = await session.execute(
                select(models.InventoryAdjustmentEvent)
                .where(
                    models.InventoryAdjustmentEvent.status == "applied",
                    models.InventoryAdjustmentEvent.new_record_id == latest_record_id,
                )
                .order_by(
                    models.InventoryAdjustmentEvent.applied_at.desc().nullslast(),
                    models.InventoryAdjustmentEvent.id.desc(),
                )
                .limit(1)
            )
            event = event_result.scalar_one_or_none()
            if event is None:
                break

            change_logs_result = await session.execute(
                select(models.InventoryChangeLog.id).where(
                    models.InventoryChangeLog.record_id == latest_record_id
                )
            )
            change_log_ids = list(change_logs_result.scalars().all())

            if not event.previous_record_id:
                break

            chain.append(
                AppliedCleanupItem(
                    event_id=int(event.id),
                    record_id=latest_record_id,
                    previous_record_id=int(event.previous_record_id),
                    subject=str(event.subject or ""),
                    sender=str(event.sender or ""),
                    applied_at=event.applied_at.isoformat() if event.applied_at else None,
                    change_log_count=len(change_log_ids),
                )
            )

            latest_record = await session.get(models.InventoryRecord, int(event.previous_record_id))

    return chain


async def _delete_rejected_events(items: List[RejectedCleanupItem]) -> int:
    if not items:
        return 0

    deleted = 0
    async with AsyncSessionLocal() as session:
        for item in items:
            event = await session.get(models.InventoryAdjustmentEvent, item.event_id)
            if event is None or event.status != "rejected":
                continue
            await session.delete(event)
            deleted += 1
        await session.commit()
    return deleted


async def _rollback_applied_chain(items: List[AppliedCleanupItem]) -> int:
    if not items:
        return 0

    deleted = 0
    async with AsyncSessionLocal() as session:
        for item in items:
            event = await session.get(models.InventoryAdjustmentEvent, item.event_id)
            target_record = await session.get(models.InventoryRecord, item.record_id)
            if event is None or target_record is None or event.status != "applied":
                continue

            change_logs_result = await session.execute(
                select(models.InventoryChangeLog).where(
                    models.InventoryChangeLog.record_id == item.record_id
                )
            )
            change_logs = list(change_logs_result.scalars().all())

            for change_log in change_logs:
                await session.delete(change_log)
            await session.delete(event)
            await session.flush()
            await session.delete(target_record)
            deleted += 1

        await session.commit()

    return deleted


async def _load_table_counts() -> List[TableCountItem]:
    table_names = [table.name for table in Base.metadata.sorted_tables]
    items: List[TableCountItem] = []
    async with engine.connect() as conn:
        for table_name in table_names:
            result = await conn.execute(text(f'SELECT COUNT(*) FROM "{table_name}"'))
            row_count = int(result.scalar_one() or 0)
            items.append(TableCountItem(table_name=table_name, row_count=row_count))
    items.sort(key=lambda item: (-item.row_count, item.table_name))
    return items


async def _truncate_all_tables() -> None:
    table_names = [f'"{table.name}"' for table in Base.metadata.sorted_tables]
    if not table_names:
        return
    truncate_sql = f"TRUNCATE TABLE {', '.join(table_names)} RESTART IDENTITY CASCADE"
    async with engine.begin() as conn:
        await conn.execute(text(truncate_sql))


async def _write_audit_log(
    *,
    action: str,
    title: str,
    summary: str,
    detail: dict,
) -> None:
    async with AsyncSessionLocal() as session:
        await create_audit_log(
            session,
            scope="system",
            action=action,
            actor="script:clear_processed_inventory_adjustments",
            entity_type="system",
            title=title,
            summary=summary,
            detail=detail,
        )
        await session.commit()


def _print_plan(
    rejected_items: List[RejectedCleanupItem],
    applied_items: List[AppliedCleanupItem],
    execute: bool,
    skip_rejected: bool,
    skip_applied: bool,
) -> None:
    mode = "执行删除" if execute else "仅预览（dry-run）"
    print("=" * 72)
    print(f"清理邮件库存变动：{mode}")
    print("=" * 72)

    if skip_rejected:
        print("已忽略（rejected）: 跳过")
    else:
        print(f"已忽略（rejected）: {len(rejected_items)} 条")
        for item in rejected_items[:10]:
            print(f"  - #{item.event_id} {item.sender} | {item.subject}")
        if len(rejected_items) > 10:
            print(f"  ... 其余 {len(rejected_items) - 10} 条省略")

    print()

    if skip_applied:
        print("已确认（applied）: 跳过")
    else:
        print(f"可安全回滚删除的已确认链: {len(applied_items)} 条")
        for item in applied_items[:10]:
            print(
                "  - "
                f"event #{item.event_id} | record #{item.record_id} -> #{item.previous_record_id} | "
                f"logs {item.change_log_count} | {item.sender} | {item.subject}"
            )
        if len(applied_items) > 10:
            print(f"  ... 其余 {len(applied_items) - 10} 条省略")

    print()
    if not execute:
        print("提示：加上 --execute 才会真正删除。")


def _print_full_database_plan(
    table_counts: List[TableCountItem],
    execute: bool,
) -> None:
    mode = "执行清空整库" if execute else "仅预览整库（dry-run）"
    print("=" * 72)
    print(f"清空整个数据库内容：{mode}")
    print("=" * 72)

    total_rows = sum(item.row_count for item in table_counts)
    print(f"业务表数量: {len(table_counts)}")
    print(f"总记录数: {total_rows}")
    print()
    print("各表记录数：")
    for item in table_counts:
        print(f"  - {item.table_name}: {item.row_count}")
    print()
    if not execute:
        print("提示：加上 --execute 才会真正清空整个数据库内容。")
    else:
        print("注意：这会删除所有用户、BOM、库存、历史、邮件库存变动等数据，只保留表结构。")


async def main() -> None:
    parser = argparse.ArgumentParser(description="清理已处理的邮件库存变动")
    parser.add_argument(
        "--all",
        action="store_true",
        help="清空整个数据库所有表内容（保留表结构）。",
    )
    parser.add_argument(
        "--execute",
        action="store_true",
        help="真正执行删除；默认仅预览。",
    )
    parser.add_argument(
        "--skip-rejected",
        action="store_true",
        help="不删除已忽略（rejected）异动。",
    )
    parser.add_argument(
        "--skip-applied",
        action="store_true",
        help="不回滚删除已确认（applied）变动。",
    )
    args = parser.parse_args()

    if args.all:
        table_counts = await _load_table_counts()
        _print_full_database_plan(table_counts=table_counts, execute=args.execute)
        if not args.execute:
            return

        await _truncate_all_tables()
        await _write_audit_log(
            action="database_cleared",
            title="整库数据已清空",
            summary="通过清理脚本执行整库清空，保留表结构并重置自增 ID",
            detail={
                "mode": "all",
                "table_count": len(table_counts),
                "total_rows": sum(item.row_count for item in table_counts),
            },
        )
        print()
        print("=" * 72)
        print("整库清空完成")
        print("=" * 72)
        print("所有业务表内容已删除，自增 ID 已重置。")
        return

    rejected_items = [] if args.skip_rejected else await _load_rejected_events()
    applied_items = [] if args.skip_applied else await _load_latest_applied_chain()

    _print_plan(
        rejected_items=rejected_items,
        applied_items=applied_items,
        execute=args.execute,
        skip_rejected=args.skip_rejected,
        skip_applied=args.skip_applied,
    )

    if not args.execute:
        return

    deleted_rejected = 0
    deleted_applied = 0

    if not args.skip_rejected:
        deleted_rejected = await _delete_rejected_events(rejected_items)
    if not args.skip_applied:
        deleted_applied = await _rollback_applied_chain(applied_items)

    await _write_audit_log(
        action="processed_inventory_adjustments_cleared",
        title="已处理邮件库存变动已清理",
        summary="通过清理脚本删除已忽略记录，并回滚删除可安全清理的已确认链",
        detail={
            "deleted_rejected_count": deleted_rejected,
            "deleted_applied_count": deleted_applied,
            "skip_rejected": args.skip_rejected,
            "skip_applied": args.skip_applied,
        },
    )

    print()
    print("=" * 72)
    print("清理完成")
    print("=" * 72)
    print(f"已删除 rejected 异动: {deleted_rejected} 条")
    print(f"已回滚删除 applied 异动: {deleted_applied} 条")


if __name__ == "__main__":
    asyncio.run(main())
