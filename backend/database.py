from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import declarative_base
from config import settings

# Convert postgresql:// to postgresql+asyncpg://
DATABASE_URL = settings.DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://")

engine = create_async_engine(DATABASE_URL, echo=False, future=True)

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)

Base = declarative_base()


async def get_db():
    """Dependency for getting async database session"""
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()


async def init_db():
    """Initialize database tables"""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await _ensure_super_admin_column(conn)
        await _ensure_pmc_soft_delete_columns(conn)
        await _ensure_audit_log_soft_delete_columns(conn)
        await _ensure_inventory_adjustment_cycle_column(conn)
    await _seed_bom_products_if_needed()


async def _ensure_super_admin_column(conn):
    exists = await conn.execute(
        text(
            """
            SELECT 1
            FROM information_schema.columns
            WHERE table_name = 'users' AND column_name = 'is_super_admin'
            LIMIT 1
            """
        )
    )
    if exists.first() is None:
        await conn.execute(
            text(
                "ALTER TABLE users ADD COLUMN is_super_admin BOOLEAN NOT NULL DEFAULT FALSE"
            )
        )

    super_admin_exists = await conn.execute(
        text(
            """
            SELECT 1
            FROM users
            WHERE role::text = 'ADMIN' AND is_super_admin = TRUE
            LIMIT 1
            """
        )
    )
    if super_admin_exists.first() is not None:
        return

    promoted = await conn.execute(
        text(
            """
            UPDATE users
            SET is_super_admin = TRUE
            WHERE id = (
                SELECT id
                FROM users
                WHERE role::text = 'ADMIN' AND username = 'admin'
                ORDER BY id ASC
                LIMIT 1
            )
            RETURNING id
            """
        )
    )
    if promoted.first() is not None:
        return

    await conn.execute(
        text(
            """
            UPDATE users
            SET is_super_admin = TRUE
            WHERE id = (
                SELECT id
                FROM users
                WHERE role::text = 'ADMIN'
                ORDER BY created_at ASC NULLS LAST, id ASC
                LIMIT 1
            )
            """
        )
    )


async def _ensure_pmc_soft_delete_columns(conn):
    checks = [
        ("bom_change_logs", "is_deleted", "ALTER TABLE bom_change_logs ADD COLUMN is_deleted BOOLEAN NOT NULL DEFAULT FALSE"),
        ("bom_change_logs", "deleted_at", "ALTER TABLE bom_change_logs ADD COLUMN deleted_at TIMESTAMP NULL"),
        ("bom_change_logs", "deleted_by", "ALTER TABLE bom_change_logs ADD COLUMN deleted_by VARCHAR(100) NULL"),
        ("inventory_change_logs", "is_deleted", "ALTER TABLE inventory_change_logs ADD COLUMN is_deleted BOOLEAN NOT NULL DEFAULT FALSE"),
        ("inventory_change_logs", "deleted_at", "ALTER TABLE inventory_change_logs ADD COLUMN deleted_at TIMESTAMP NULL"),
        ("inventory_change_logs", "deleted_by", "ALTER TABLE inventory_change_logs ADD COLUMN deleted_by VARCHAR(100) NULL"),
    ]
    for table_name, column_name, ddl in checks:
        exists = await conn.execute(
            text(
                """
                SELECT 1
                FROM information_schema.columns
                WHERE table_name = :table_name AND column_name = :column_name
                LIMIT 1
                """
            ),
            {"table_name": table_name, "column_name": column_name},
        )
        if exists.first() is None:
            await conn.execute(text(ddl))


async def _ensure_inventory_adjustment_cycle_column(conn):
    exists = await conn.execute(
        text(
            """
            SELECT 1
            FROM information_schema.columns
            WHERE table_name = 'inventory_adjustment_events' AND column_name = 'cycle_id'
            LIMIT 1
            """
        )
    )
    if exists.first() is None:
        await conn.execute(
            text(
                "ALTER TABLE inventory_adjustment_events ADD COLUMN cycle_id INTEGER NULL"
            )
        )
        await conn.execute(
            text(
                """
                ALTER TABLE inventory_adjustment_events
                ADD CONSTRAINT fk_inventory_adjustment_events_cycle_id
                FOREIGN KEY (cycle_id) REFERENCES inventory_reconciliation_cycles (id)
                """
            )
        )


async def _ensure_audit_log_soft_delete_columns(conn):
    checks = [
        ("audit_logs", "is_deleted", "ALTER TABLE audit_logs ADD COLUMN is_deleted BOOLEAN NOT NULL DEFAULT FALSE"),
        ("audit_logs", "deleted_at", "ALTER TABLE audit_logs ADD COLUMN deleted_at TIMESTAMP NULL"),
        ("audit_logs", "deleted_by", "ALTER TABLE audit_logs ADD COLUMN deleted_by VARCHAR(100) NULL"),
    ]
    for table_name, column_name, ddl in checks:
        exists = await conn.execute(
            text(
                """
                SELECT 1
                FROM information_schema.columns
                WHERE table_name = :table_name AND column_name = :column_name
                LIMIT 1
                """
            ),
            {"table_name": table_name, "column_name": column_name},
        )
        if exists.first() is None:
            await conn.execute(text(ddl))


async def _seed_bom_products_if_needed():
    from sqlalchemy import select

    import models
    from services.bom_override_service import bootstrap_bom_database_if_needed

    async with AsyncSessionLocal() as session:
        result = await session.execute(select(models.BomProduct.id).limit(1))
        if result.first() is not None:
            return
        await bootstrap_bom_database_if_needed(session)
