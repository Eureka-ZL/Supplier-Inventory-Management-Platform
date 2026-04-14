"""
初始化数据库

运行此脚本来创建数据库表结构并创建初始管理员账户
"""

import asyncio
from database import init_db, AsyncSessionLocal
from auth import get_password_hash
from models import User, UserRole
from sqlalchemy import select
from services.audit_log_service import create_audit_log


async def create_default_admin():
    """创建默认管理员账户"""
    async with AsyncSessionLocal() as session:
        # 检查是否已存在管理员
        result = await session.execute(select(User).where(User.username == "admin"))
        existing_admin = result.scalar_one_or_none()

        if existing_admin:
            print("⚠️  管理员账户已存在，跳过创建")
            return

        # 创建默认管理员
        admin = User(
            username="admin",
            hashed_password=get_password_hash("admin123"),
            plain_password=None,
            role=UserRole.ADMIN,
            is_super_admin=True,
            is_active=True,
        )

        session.add(admin)
        await session.commit()

        print("✅ 默认管理员账户创建成功！")
        print("   用户名: admin")
        print("   密码: admin123")
        print("   ⚠️  请登录后立即修改密码！")


async def create_default_iqc():
    """创建默认 IQC 账户"""
    async with AsyncSessionLocal() as session:
        # 检查是否已存在 IQC 用户
        result = await session.execute(select(User).where(User.username == "iqc"))
        existing_iqc = result.scalar_one_or_none()

        if existing_iqc:
            print("⚠️  IQC 账户已存在，跳过创建")
            return

        # 创建默认 IQC 用户
        iqc = User(
            username="iqc",
            hashed_password=get_password_hash("iqc123"),
            plain_password="iqc123",  # 仅用于演示
            role=UserRole.IQC,
            is_active=True,
        )

        session.add(iqc)
        await session.commit()

        print("✅ 默认 IQC 账户创建成功！")
        print("   用户名: iqc")
        print("   密码: iqc123")


async def create_default_pmc():
    """创建默认 PMC 账户"""
    async with AsyncSessionLocal() as session:
        # 检查是否已存在 PMC 用户
        result = await session.execute(select(User).where(User.username == "pmc"))
        existing_pmc = result.scalar_one_or_none()

        if existing_pmc:
            print("⚠️  PMC 账户已存在，跳过创建")
            return

        # 创建默认 PMC 用户
        pmc = User(
            username="pmc",
            hashed_password=get_password_hash("pmc123"),
            plain_password="pmc123",  # 仅用于演示
            role=UserRole.PMC,
            is_active=True,
        )

        session.add(pmc)
        await session.commit()

        print("✅ 默认 PMC 账户创建成功！")
        print("   用户名: pmc")
        print("   密码: pmc123")


async def main():
    print("=" * 60)
    print("初始化数据库...")
    print("=" * 60)

    await init_db()
    print("✅ 数据库表创建完成！")

    print("\n" + "=" * 60)
    print("创建初始账户...")
    print("=" * 60)

    await create_default_admin()
    await create_default_iqc()
    await create_default_pmc()
    async with AsyncSessionLocal() as session:
        await create_audit_log(
            session,
            scope="system",
            action="database_initialized",
            actor="script:init_db",
            entity_type="system",
            title="数据库初始化已执行",
            summary="默认管理员、IQC、PMC 账户已检查并初始化",
            detail={
                "default_users": ["admin", "iqc", "pmc"],
            },
        )
        await session.commit()

    print("\n" + "=" * 60)
    print("系统初始化完成！")
    print("=" * 60)
    print("\n请使用以下账户登录:")
    print("  管理员:")
    print("    - 用户名: admin")
    print("    - 密码: admin123")
    print("  IQC:")
    print("    - 用户名: iqc")
    print("    - 密码: iqc123")
    print("  PMC:")
    print("    - 用户名: pmc")
    print("    - 密码: pmc123")
    print("\n登录后可以创建更多用户账户。")


if __name__ == "__main__":
    asyncio.run(main())
