import asyncio
import logging
import os

from sqlalchemy import select, text

from database import AsyncSessionLocal, init_db, engine
from import_suppliers import import_suppliers_from_excel
from init_db import create_default_admin, create_default_iqc, create_default_pmc
from models import Supplier

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")


async def wait_for_database(max_retries: int = 60, delay_seconds: float = 2.0) -> None:
    for attempt in range(1, max_retries + 1):
        try:
            async with engine.begin() as conn:
                await conn.execute(text("SELECT 1"))
            logger.info("Database is ready")
            return
        except Exception as exc:
            logger.info("Waiting for database (%s/%s): %s", attempt, max_retries, exc)
            await asyncio.sleep(delay_seconds)
    raise RuntimeError("Database did not become ready in time")


async def seed_suppliers_if_needed() -> None:
    excel_path = os.path.join(os.path.dirname(__file__), "..", "供应商.xlsx")
    excel_path = os.path.abspath(excel_path)

    async with AsyncSessionLocal() as session:
        result = await session.execute(select(Supplier.id).limit(1))
        if result.first() is not None:
            logger.info("Suppliers already exist, skipping Excel import")
            return

        if not os.path.exists(excel_path):
            logger.warning("Supplier seed file not found at %s, skipping import", excel_path)
            return

        logger.info("Importing suppliers from %s", excel_path)
        await import_suppliers_from_excel(excel_path, session)
        logger.info("Supplier Excel import completed")


async def main() -> None:
    logger.info("Bootstrap started")
    await wait_for_database()
    await init_db()
    await create_default_admin()
    await create_default_iqc()
    await create_default_pmc()
    await seed_suppliers_if_needed()
    logger.info("Bootstrap finished")


if __name__ == "__main__":
    asyncio.run(main())
