"""
导入供应商数据脚本
从 供应商.xlsx 文件中导入供应商及其联系人信息到数据库
"""

import pandas as pd
import asyncio
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from sqlalchemy.orm import selectinload
from database import AsyncSessionLocal, engine, Base
from models import Supplier, SupplierContact
from datetime import datetime
import sys
from services.audit_log_service import create_audit_log


def clean_material_info(material_str):
    """
    清理物料信息字符串
    这是每个供应商具体供应的物料类型,存储为备注信息
    """
    if pd.isna(material_str):
        return None

    material_str = str(material_str).strip()

    # 跳过统计类行
    if (
        "工作地点" in material_str
        or "供应商总数" in material_str
        or "合作供应商" in material_str
        or "提交回复" in material_str
        or material_str in ["nan", "", "NaN"]
    ):
        return None

    return material_str


def clean_phone(phone_str):
    """清理电话号码格式"""
    if pd.isna(phone_str):
        return None
    phone_str = str(phone_str).strip()
    if phone_str in ["nan", "", "NaN"]:
        return None
    return phone_str


def clean_email(email_str):
    """清理邮箱格式"""
    if pd.isna(email_str):
        return None
    email_str = str(email_str).strip()
    if email_str in ["nan", "", "NaN"]:
        return None
    return email_str


def get_column_value(row, keys):
    """
    尝试从多个可能的列名中获取值
    keys: 可能的列名列表
    """
    for key in keys:
        # 尝试直接获取
        if key in row and pd.notna(row[key]):
            return row[key]
        # 尝试带空格的键名 (有些Excel表头可能有空格)
        key_space = f" {key}"
        if key_space in row and pd.notna(row[key_space]):
            return row[key_space]
        key_space_after = f"{key} "
        if key_space_after in row and pd.notna(row[key_space_after]):
            return row[key_space_after]
    return None


async def import_suppliers_from_excel(excel_path: str, db: AsyncSession):
    """
    从Excel文件导入供应商数据

    Excel结构:
    - 有5个工作表(sheet),每个代表一个供应商类别:
      1. 结构&机电
      2. 电子元器件
      3. 附配件及包材
      4. 手板
      5. 测试认证
    - 每个sheet的第1-2行: 标题
    - 第3行: 列名 (序号、物料类别、供应商全称、联系人、职务、联系电话、EMAIL、公司地址、导入时间、新增、是否现场考察)
    - 第4行开始: 数据
    - 当"序号"有值时,表示新的供应商
    - "序号"为空的行是该供应商的额外联系人
    """

    print(f"开始读取Excel文件: {excel_path}")

    supplier_payloads = _parse_supplier_excel(excel_path)
    payload_names = set(supplier_payloads.keys())

    existing_result = await db.execute(
        select(Supplier).options(selectinload(Supplier.contacts))
    )
    existing_suppliers = {supplier.name: supplier for supplier in existing_result.scalars().all()}

    total_suppliers_created = 0
    total_suppliers_updated = 0
    total_contacts_replaced = 0
    total_suppliers_archived = 0

    for supplier_name, payload in supplier_payloads.items():
        existing_supplier = existing_suppliers.get(supplier_name)
        if existing_supplier:
            supplier = existing_supplier
            total_suppliers_updated += 1
            print(f"更新供应商: {supplier_name}")
        else:
            supplier = Supplier(name=supplier_name)
            db.add(supplier)
            total_suppliers_created += 1
            print(f"创建供应商: {supplier_name}")

        supplier.category = payload["category"]
        supplier.address = payload["address"]
        supplier.notes = payload["notes"]
        supplier.office_phone = payload["office_phone"]
        supplier.fax = payload["fax"]
        supplier.is_new = payload["is_new"]
        supplier.is_site_inspected = payload["is_site_inspected"]
        supplier.is_deleted = False
        supplier.is_active = True
        supplier.created_at = payload["created_at"] or supplier.created_at or datetime.utcnow()

        await db.flush()
        await db.execute(
            delete(SupplierContact).where(SupplierContact.supplier_id == supplier.id)
        )
        for index, contact_payload in enumerate(payload["contacts"]):
            db.add(
                SupplierContact(
                    supplier_id=supplier.id,
                    name=contact_payload["name"],
                    position=contact_payload["position"],
                    phone=contact_payload["phone"],
                    email=contact_payload["email"],
                    is_primary=index == 0,
                )
            )
        total_contacts_replaced += len(payload["contacts"])

    for supplier_name, existing_supplier in existing_suppliers.items():
        if supplier_name in payload_names:
            continue
        if not existing_supplier.is_deleted or existing_supplier.is_active:
            print(f"归档未在最新表中的供应商: {supplier_name}")
            existing_supplier.is_deleted = True
            existing_supplier.is_active = False
            total_suppliers_archived += 1

    try:
        await db.commit()
        print(f"\n{'='*60}")
        print("✅ 全量覆盖导入成功!")
        print(f"{'='*60}")
        print(f"   当前有效供应商: {len(payload_names)}")
        print(f"   新建供应商: {total_suppliers_created}")
        print(f"   更新供应商: {total_suppliers_updated}")
        print(f"   替换联系人: {total_contacts_replaced}")
        print(f"   归档供应商: {total_suppliers_archived}")
        return {
            "active_supplier_count": len(payload_names),
            "created_supplier_count": total_suppliers_created,
            "updated_supplier_count": total_suppliers_updated,
            "replaced_contact_count": total_contacts_replaced,
            "archived_supplier_count": total_suppliers_archived,
        }
    except Exception as e:
        await db.rollback()
        print(f"\n❌ 导入失败: {e}")
        raise


def _parse_supplier_excel(excel_path: str):
    excel_file = pd.ExcelFile(excel_path)
    sheet_names = excel_file.sheet_names

    print(f"找到 {len(sheet_names)} 个工作表: {', '.join(sheet_names)}\n")

    supplier_payloads = {}
    office_phone_keys = [
        "座机",
        "公司座机",
        "固定电话",
        "电话",
        "办公电话",
        "公司电话",
    ]
    fax_keys = ["传真", "公司传真", "传真号", "公司传真号"]

    for sheet_name in sheet_names:
        supplier_category = sheet_name.strip()
        print(f"{'='*60}")
        print(f"处理工作表(供应商分类): {supplier_category}")
        print(f"{'='*60}")

        if sheet_name in ["手板", "测试认证"]:
            df = pd.read_excel(excel_path, sheet_name=sheet_name, header=1)
        else:
            df = pd.read_excel(excel_path, sheet_name=sheet_name, header=2)

        print(f"共读取 {len(df)} 行数据")
        print(f"列名: {df.columns.tolist()}")

        column_mapping = {
            "供应商全称": "供应商名称",
            "物料类别": "物料类别",
            "供应物料": "供应物料",
            "供应商类型": "供应商类型",
            "联系人": "联系人",
            "姓名": "联系人",
            "职务": "职务",
            "联系人职位": "职务",
            "联系电话": "手机",
            "EMAIL": "邮箱",
            "公司地址": "地址",
        }
        df.rename(columns=column_mapping, inplace=True)
        print(f"标准化后列名: {df.columns.tolist()}\n")

        current_supplier_name = None

        for idx, row in df.iterrows():
            if pd.notna(row["序号"]):
                supplier_name = (
                    str(row["供应商名称"]).strip()
                    if pd.notna(row.get("供应商名称"))
                    else None
                )
                if not supplier_name or supplier_name == "nan":
                    print(f"  警告: 第 {idx + 4} 行缺少供应商名称,跳过")
                    current_supplier_name = None
                    continue

                current_supplier_name = supplier_name
                payload = supplier_payloads.setdefault(
                    supplier_name,
                    {
                        "category": set(),
                        "notes_set": set(),
                        "address": None,
                        "created_at": None,
                        "is_new": False,
                        "is_site_inspected": False,
                        "office_phone": None,
                        "fax": None,
                        "contacts": [],
                    },
                )
                payload["category"].add(supplier_category)

                material_info = None
                for col in ["物料类别", "供应物料", "供应商类型"]:
                    if col in df.columns and pd.notna(row.get(col)):
                        material_info = clean_material_info(row[col])
                        if material_info:
                            break
                if material_info:
                    payload["notes_set"].add(material_info)

                if pd.notna(row.get("地址")):
                    payload["address"] = str(row.get("地址", "")).strip()

                if pd.notna(row.get("导入时间")):
                    try:
                        payload["created_at"] = pd.to_datetime(row["导入时间"]).to_pydatetime()
                    except Exception:
                        payload["created_at"] = payload["created_at"] or datetime.utcnow()

                payload["is_new"] = payload["is_new"] or (
                    pd.notna(row.get("新增")) and str(row["新增"]).strip().upper() == "Y"
                )
                payload["is_site_inspected"] = payload["is_site_inspected"] or (
                    pd.notna(row.get("是否现场考察"))
                    and str(row["是否现场考察"]).strip().upper() == "Y"
                )

                office_phone_val = get_column_value(row, office_phone_keys)
                fax_val = get_column_value(row, fax_keys)
                if not payload["office_phone"] and pd.notna(office_phone_val):
                    payload["office_phone"] = clean_phone(office_phone_val)
                if not payload["fax"] and pd.notna(fax_val):
                    payload["fax"] = clean_phone(fax_val)
            else:
                if current_supplier_name is None:
                    continue
                payload = supplier_payloads[current_supplier_name]

            if current_supplier_name is None:
                continue

            payload = supplier_payloads[current_supplier_name]
            contact_name = (
                str(row.get("联系人", "")).strip()
                if pd.notna(row.get("联系人"))
                else None
            )
            contact_phone = clean_phone(row.get("手机"))
            contact_email = clean_email(row.get("邮箱"))
            contact_position = (
                str(row.get("职务", "")).strip()
                if pd.notna(row.get("职务"))
                else None
            )
            if contact_name or contact_phone or contact_email:
                contact_key = (
                    contact_name or "",
                    contact_phone or "",
                    contact_email or "",
                    contact_position or "",
                )
                existing_contact_keys = {
                    (
                        c["name"] or "",
                        c["phone"] or "",
                        c["email"] or "",
                        c["position"] or "",
                    )
                    for c in payload["contacts"]
                }
                if contact_key not in existing_contact_keys:
                    payload["contacts"].append(
                        {
                            "name": contact_name,
                            "position": contact_position,
                            "phone": contact_phone,
                            "email": contact_email,
                        }
                    )

    for payload in supplier_payloads.values():
        payload["category"] = sorted(payload["category"])
        payload["notes"] = "; ".join(sorted(payload["notes_set"])) or None
        payload.pop("notes_set", None)

    return supplier_payloads


async def main():
    # 创建数据库表(如果不存在)
    print("初始化数据库表...")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # 创建数据库会话
    async with AsyncSessionLocal() as db:
        try:
            # 导入供应商数据
            excel_path = "../供应商.xlsx"
            result_summary = await import_suppliers_from_excel(excel_path, db)

            await create_audit_log(
                db,
                scope="supplier",
                action="supplier_excel_imported",
                actor="script:import_suppliers",
                entity_type="supplier",
                title="供应商 Excel 已通过脚本导入",
                summary="执行脚本完成供应商全量覆盖导入",
                detail={
                    "excel_path": excel_path,
                    **result_summary,
                },
            )
            await db.commit()

            # 显示导入结果统计
            print("\n" + "=" * 50)
            print("数据库统计:")
            result = await db.execute(select(Supplier))
            supplier_count = len(result.scalars().all())
            result = await db.execute(select(SupplierContact))
            contact_count = len(result.scalars().all())
            print(f"总供应商数: {supplier_count}")
            print(f"总联系人数: {contact_count}")
            print("=" * 50)

        except Exception as e:
            print(f"错误: {e}")
            import traceback

            traceback.print_exc()
            sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
