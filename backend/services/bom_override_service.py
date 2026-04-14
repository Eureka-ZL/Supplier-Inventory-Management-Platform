import glob
import json
import logging
import os
import re
import tempfile
import zipfile
from datetime import datetime
from typing import Any, Dict, List

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

import models
from services.bom_parser import parse_bom_products_from_file
from services.inventory_parser import InventoryParser

logger = logging.getLogger(__name__)
PART_NO_STRICT_PATTERN = re.compile(r"^\d+$")
REMOVED_BOM_PRODUCT_CODES = {"110100000344"}
REMOVED_BOM_PRODUCT_KEYWORDS = ("海外版-欧洲",)


def _is_removed_bom_product(
    product_code: str = "",
    product_name: str = "",
    source_file: str = "",
) -> bool:
    code = str(product_code or "").strip()
    name = str(product_name or "").strip()
    source = str(source_file or "").strip()
    if code and code in REMOVED_BOM_PRODUCT_CODES:
        return True
    haystacks = [name, source]
    return any(
        keyword and any(keyword in value for value in haystacks)
        for keyword in REMOVED_BOM_PRODUCT_KEYWORDS
    )


def get_bom_base_dir() -> str:
    bom_base = os.path.join(os.path.dirname(__file__), "..", "..", "bom")
    if not os.path.exists(bom_base):
        bom_base = os.path.join(os.getcwd(), "..", "bom")
    return bom_base


def load_local_bom_products() -> List[Dict[str, Any]]:
    return load_bom_products_from_dir(get_bom_base_dir())


def load_bom_products_from_dir(base_dir: str) -> List[Dict[str, Any]]:
    if not os.path.exists(base_dir):
        return []

    files = glob.glob(os.path.join(base_dir, "**/*.*"), recursive=True)
    files = [
        f
        for f in files
        if "~$" not in f
        and os.path.isfile(f)
        and os.path.splitext(f)[1].lower() in {".xls", ".xlsx"}
        and "__MACOSX" not in f
        and not os.path.basename(f).startswith("._")
    ]
    products: List[Dict[str, Any]] = []
    for filepath in sorted(files):
        try:
            category = os.path.basename(os.path.dirname(filepath))
            parsed_products = parse_bom_products_from_file(filepath)
            for product in parsed_products:
                product_code = str(product.get("product_code", "")).strip()
                product_name = str(product.get("product_name", "")).strip()
                source_file = os.path.basename(filepath)
                if _is_removed_bom_product(
                    product_code=product_code,
                    product_name=product_name,
                    source_file=source_file,
                ):
                    continue
                products.append(
                    {
                        "product_code": product_code,
                        "product_name": product_name,
                        "category": category,
                        "total_parts": int(product.get("total_parts", 0) or 0),
                        "parts": product.get("parts", []) or [],
                        "file": source_file,
                    }
                )
        except Exception as e:
            logger.warning("Failed to parse BOM file %s: %s", filepath, e)
    return products


def load_bom_products_from_zip(zip_path: str) -> Dict[str, Any]:
    with tempfile.TemporaryDirectory(prefix="pmc_bom_zip_") as extract_dir:
        excel_members = []
        with zipfile.ZipFile(zip_path, "r") as zf:
            for info in zf.infolist():
                if info.is_dir():
                    continue
                name = info.filename
                if info.flag_bits & 0x800:
                    fixed_name = name
                else:
                    try:
                        raw_bytes = name.encode('cp437')
                        try:
                            fixed_name = raw_bytes.decode('utf-8')
                        except UnicodeDecodeError:
                            fixed_name = raw_bytes.decode('gbk')
                    except Exception:
                        fixed_name = name

                if os.path.splitext(fixed_name)[1].lower() not in {".xls", ".xlsx"}:
                    continue
                if "~$" in os.path.basename(fixed_name) or "__MACOSX" in fixed_name or os.path.basename(fixed_name).startswith("._"):
                    continue

                fixed_name_clean = fixed_name.lstrip("/")
                target_path = os.path.join(extract_dir, fixed_name_clean)
                os.makedirs(os.path.dirname(target_path), exist_ok=True)
                
                with zf.open(info) as source, open(target_path, "wb") as target:
                    import shutil
                    shutil.copyfileobj(source, target)
                excel_members.append(fixed_name)

            if not excel_members:
                raise ValueError("压缩包中未发现 BOM Excel 文件")

        products = load_bom_products_from_dir(extract_dir)
        if not products:
            raise ValueError("压缩包中的 BOM 文件未解析出有效产品")

        return {
            "products": products,
            "file_count": len(excel_members),
        }


def _clean_part_payload(parts: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    cleaned: List[Dict[str, Any]] = []
    for idx, part in enumerate(parts):
        part_no = str(part.get("part_no", "") or "").strip()
        if not part_no:
            raise ValueError(f"第 {idx + 1} 行物料编码不能为空")
        if not PART_NO_STRICT_PATTERN.match(part_no):
            raise ValueError(f"第 {idx + 1} 行物料编码必须为纯数字")
        qty_raw = part.get("qty", 1)
        try:
            qty = float(qty_raw)
        except Exception:
            raise ValueError(f"第 {idx + 1} 行用量必须是数字")
        if qty <= 0:
            raise ValueError(f"第 {idx + 1} 行用量必须大于 0")
        alt_group_raw = part.get("alt_group")
        alt_group = None
        if alt_group_raw not in ("", None):
            try:
                alt_group = int(alt_group_raw)
            except Exception:
                raise ValueError(f"第 {idx + 1} 行互替组必须是整数")
            if alt_group <= 0:
                raise ValueError(f"第 {idx + 1} 行互替组必须大于 0")
        cleaned.append(
            {
                "part_no": part_no,
                "name": str(part.get("name", "") or "").strip(),
                "spec": str(part.get("spec", "") or "").strip(),
                "qty": qty,
                "manufacturer": str(part.get("manufacturer", "") or "").strip(),
                "alt_group": alt_group,
            }
        )
    if not cleaned:
        raise ValueError("BOM条目不能为空")
    return cleaned


def _serialize_parts_from_db_row(row: models.BomProduct) -> List[Dict[str, Any]]:
    parts: List[Dict[str, Any]] = []
    for part in row.parts:
        parts.append(
            {
                "part_no": str(part.part_no or "").strip(),
                "name": str(part.name or "").strip(),
                "spec": str(part.spec or "").strip(),
                "qty": float(part.qty or 0),
                "manufacturer": str(part.manufacturer or "").strip(),
                "alt_group": int(part.alt_group) if part.alt_group is not None else None,
            }
        )
    return parts


async def _serialize_parts_by_product_id(db: AsyncSession, bom_product_id: int) -> List[Dict[str, Any]]:
    result = await db.execute(
        select(models.BomProductPart)
        .where(models.BomProductPart.bom_product_id == bom_product_id)
        .order_by(models.BomProductPart.row_no.asc(), models.BomProductPart.id.asc())
    )
    rows = result.scalars().all()
    return [
        {
            "part_no": str(part.part_no or "").strip(),
            "name": str(part.name or "").strip(),
            "spec": str(part.spec or "").strip(),
            "qty": float(part.qty or 0),
            "manufacturer": str(part.manufacturer or "").strip(),
            "alt_group": int(part.alt_group) if part.alt_group is not None else None,
        }
        for part in rows
    ]


def _format_product_from_db_row(row: models.BomProduct) -> Dict[str, Any]:
    parts = _serialize_parts_from_db_row(row)
    return {
        "product_code": str(row.product_code or "").strip(),
        "product_name": str(row.product_name or "").strip(),
        "category": str(row.line or "").strip(),
        "line": str(row.line or "").strip(),
        "total_parts": len(parts),
        "parts": parts,
        "file": str(row.source_file or "").strip(),
        "source_file": str(row.source_file or "").strip(),
        "is_finished_product": bool(row.is_finished_product),
    }


async def load_legacy_bom_override_map(db: AsyncSession) -> Dict[str, Dict[str, Any]]:
    result = await db.execute(select(models.BomProductOverride))
    rows = result.scalars().all()
    override_map: Dict[str, Dict[str, Any]] = {}
    for row in rows:
        product_code = str(row.product_code or "").strip()
        if not product_code:
            continue
        try:
            payload = json.loads(row.parts_json or "[]")
        except Exception:
            payload = []
        override_map[product_code] = {
            "parts": payload if isinstance(payload, list) else [],
            "updated_at": row.updated_at.isoformat() if row.updated_at else None,
            "updated_by": row.updated_by,
        }
    return override_map


def merge_legacy_bom_overrides_into_products(
    products: List[Dict[str, Any]], override_map: Dict[str, Dict[str, Any]]
) -> List[Dict[str, Any]]:
    if not override_map:
        return products
    merged: List[Dict[str, Any]] = []
    for product in products:
        product_code = str(product.get("product_code", "")).strip()
        override = override_map.get(product_code)
        if not override:
            merged.append(product)
            continue
        parts = override.get("parts") if isinstance(override, dict) else None
        if not isinstance(parts, list):
            merged.append(product)
            continue
        next_product = dict(product)
        next_product["parts"] = parts
        next_product["total_parts"] = len(parts)
        merged.append(next_product)
    return merged


def _infer_finished_product_codes(products: List[Dict[str, Any]]) -> set[str]:
    all_codes = {
        str(product.get("product_code", "")).strip()
        for product in products
        if str(product.get("product_code", "")).strip()
    }
    referenced_codes: set[str] = set()
    for product in products:
        for part in product.get("parts", []) or []:
            part_no = str(part.get("part_no", "")).strip()
            if part_no in all_codes:
                referenced_codes.add(part_no)
    root_codes = {code for code in all_codes if code not in referenced_codes}
    final_codes = {code for code in root_codes if code.startswith("1101")}
    return final_codes if final_codes else root_codes


async def import_local_bom_seed_into_database(
    db: AsyncSession,
    *,
    overwrite: bool = False,
) -> int:
    local_products = load_local_bom_products()
    if not local_products:
        logger.warning("No local BOM files found for bootstrap import")
        return 0

    override_map = await load_legacy_bom_override_map(db)
    effective_products = merge_legacy_bom_overrides_into_products(local_products, override_map)
    return await import_bom_products_into_database(
        db,
        effective_products,
        overwrite=overwrite,
        merge_missing_existing=overwrite,
    )


async def import_bom_products_into_database(
    db: AsyncSession,
    products: List[Dict[str, Any]],
    *,
    overwrite: bool = False,
    merge_missing_existing: bool = False,
) -> int:
    if not products:
        raise ValueError("没有可导入的 BOM 产品数据")

    finished_codes = _infer_finished_product_codes(products)

    if overwrite:
        await db.execute(delete(models.BomProductPart))
        await db.execute(delete(models.BomProduct))
        await db.flush()

    existing_result = await db.execute(
        select(models.BomProduct).options(selectinload(models.BomProduct.parts))
    )
    existing_rows = existing_result.scalars().all()
    existing_by_code = {
        str(row.product_code or "").strip(): row
        for row in existing_rows
        if str(row.product_code or "").strip()
    }

    imported_count = 0
    seen_codes: set[str] = set()
    for product in products:
        product_code = str(product.get("product_code", "")).strip()
        if not product_code:
            continue
        seen_codes.add(product_code)
        cleaned_parts = _clean_part_payload(product.get("parts", []) or [])
        row = existing_by_code.get(product_code)
        if row is None:
            row = models.BomProduct(
                product_code=product_code,
                product_name=str(product.get("product_name", "") or "").strip(),
                line=str(product.get("category", "") or product.get("line", "") or "").strip(),
                source_file=str(product.get("file", "") or product.get("source_file", "") or "").strip(),
                is_finished_product=product_code in finished_codes,
                imported_at=datetime.utcnow(),
            )
            db.add(row)
            await db.flush()
        else:
            row.product_name = str(product.get("product_name", "") or "").strip()
            row.line = str(product.get("category", "") or product.get("line", "") or "").strip()
            row.source_file = str(product.get("file", "") or product.get("source_file", "") or "").strip()
            row.is_finished_product = product_code in finished_codes
            await db.execute(
                delete(models.BomProductPart).where(models.BomProductPart.bom_product_id == row.id)
            )
            await db.flush()

        db.add_all([
            models.BomProductPart(
                bom_product_id=row.id,
                row_no=index + 1,
                part_no=str(part.get("part_no", "")).strip(),
                name=str(part.get("name", "") or "").strip(),
                spec=str(part.get("spec", "") or "").strip(),
                qty=float(part.get("qty", 0) or 0),
                manufacturer=str(part.get("manufacturer", "") or "").strip(),
                alt_group=int(part.get("alt_group")) if part.get("alt_group") is not None else None,
            )
            for index, part in enumerate(cleaned_parts)
        ])
        imported_count += 1

    if merge_missing_existing:
        for code, row in existing_by_code.items():
            if code not in seen_codes:
                await db.delete(row)

    await db.commit()
    logger.info("Imported %s BOM products into database", imported_count)
    return imported_count


async def import_bom_zip_into_database(
    db: AsyncSession,
    *,
    zip_path: str,
    overwrite: bool = True,
) -> Dict[str, Any]:
    parsed = load_bom_products_from_zip(zip_path)
    products = parsed["products"]
    imported_count = await import_bom_products_into_database(
        db,
        products,
        overwrite=overwrite,
        merge_missing_existing=overwrite,
    )

    finished_codes = _infer_finished_product_codes(products)
    total_parts = sum(len(product.get("parts", []) or []) for product in products)

    return {
        "imported_products": imported_count,
        "product_count": len(products),
        "finished_product_count": len(finished_codes),
        "part_count": total_parts,
        "file_count": int(parsed.get("file_count", 0) or 0),
    }


async def bootstrap_bom_database_if_needed(db: AsyncSession) -> int:
    result = await db.execute(select(models.BomProduct.id).limit(1))
    if result.first() is not None:
        return 0
    return await import_local_bom_seed_into_database(db, overwrite=False)


async def load_bom_products_from_database(db: AsyncSession) -> List[Dict[str, Any]]:
    await bootstrap_bom_database_if_needed(db)
    result = await db.execute(
        select(models.BomProduct)
        .options(selectinload(models.BomProduct.parts))
        .order_by(models.BomProduct.line.asc(), models.BomProduct.product_name.asc(), models.BomProduct.product_code.asc())
    )
    rows = result.scalars().all()
    products: List[Dict[str, Any]] = []
    for row in rows:
        product = _format_product_from_db_row(row)
        if _is_removed_bom_product(
            product_code=str(product.get("product_code", "")),
            product_name=str(product.get("product_name", "")),
            source_file=str(product.get("source_file", "")),
        ):
            continue
        products.append(product)
    return products


async def build_inventory_parser_from_database(db: AsyncSession) -> InventoryParser:
    products = await load_bom_products_from_database(db)
    return InventoryParser(bom_products=products)


async def get_bom_database_status(db: AsyncSession) -> Dict[str, Any]:
    await bootstrap_bom_database_if_needed(db)
    result = await db.execute(
        select(models.BomProduct)
        .options(selectinload(models.BomProduct.parts))
        .order_by(models.BomProduct.updated_at.desc(), models.BomProduct.id.desc())
    )
    rows = result.scalars().all()
    visible_rows = [
        row for row in rows
        if not _is_removed_bom_product(
            product_code=str(row.product_code or ""),
            product_name=str(row.product_name or ""),
            source_file=str(row.source_file or ""),
        )
    ]
    product_count = len(visible_rows)
    finished_product_count = sum(1 for row in visible_rows if bool(row.is_finished_product))
    part_count = sum(len(row.parts or []) for row in visible_rows)
    latest_product = visible_rows[0] if visible_rows else None

    return {
        "ready": product_count > 0,
        "runtime_source": "database",
        "product_count": product_count,
        "finished_product_count": finished_product_count,
        "part_count": part_count,
        "latest_updated_at": latest_product.updated_at.isoformat() if latest_product and latest_product.updated_at else None,
        "latest_source_file": str(latest_product.source_file or "").strip() if latest_product else "",
    }


async def save_bom_product_parts(
    db: AsyncSession,
    product_code: str,
    parts: List[Dict[str, Any]],
    actor: str,
) -> Dict[str, Any]:
    from services.change_log_service import create_bom_change_log

    await bootstrap_bom_database_if_needed(db)
    product_code_clean = str(product_code or "").strip()
    if not product_code_clean:
        raise ValueError("product_code不能为空")

    result = await db.execute(
        select(models.BomProduct)
        .where(models.BomProduct.product_code == product_code_clean)
    )
    row = result.scalar_one_or_none()
    if not row:
        raise ValueError(f"未找到可编辑BOM产品: {product_code_clean}")

    cleaned_parts = _clean_part_payload(parts)
    before_parts = await _serialize_parts_by_product_id(db, row.id)

    await db.execute(
        delete(models.BomProductPart).where(models.BomProductPart.bom_product_id == row.id)
    )
    await db.flush()
    db.add_all([
        models.BomProductPart(
            bom_product_id=row.id,
            row_no=index + 1,
            part_no=str(part.get("part_no", "")).strip(),
            name=str(part.get("name", "") or "").strip(),
            spec=str(part.get("spec", "") or "").strip(),
            qty=float(part.get("qty", 0) or 0),
            manufacturer=str(part.get("manufacturer", "") or "").strip(),
            alt_group=int(part.get("alt_group")) if part.get("alt_group") is not None else None,
        )
        for index, part in enumerate(cleaned_parts)
    ])
    row.updated_at = datetime.utcnow()

    await create_bom_change_log(
        db=db,
        changed_by=actor,
        product_code=product_code_clean,
        product_name=str(row.product_name or "").strip(),
        line=str(row.line or "").strip(),
        source_file=str(row.source_file or "").strip(),
        before_parts=before_parts,
        after_parts=cleaned_parts,
    )
    await db.commit()
    refreshed_result = await db.execute(
        select(models.BomProduct)
        .options(selectinload(models.BomProduct.parts))
        .where(models.BomProduct.id == row.id)
    )
    refreshed_row = refreshed_result.scalar_one()

    return _format_product_from_db_row(refreshed_row)
