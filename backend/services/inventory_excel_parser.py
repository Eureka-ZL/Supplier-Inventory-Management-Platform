import io
import logging
import math
import re
from typing import Any, Dict, List, Optional, Set

import pandas as pd

logger = logging.getLogger(__name__)

PART_NO_PATTERN = re.compile(r"^\d{4,15}$")
PART_NO_FUZZY_PATTERN = re.compile(r"(\d{4,15})")
SUSPICIOUS_SHORT_NUMERIC_PART_PATTERN = re.compile(r"^\d{4,7}$")


def clean_text(value: Any) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    if text in ("", "nan", "NaN", "None"):
        return ""
    return text


def to_number(value: Any, default: float = 0.0) -> float:
    try:
        if value is None:
            return default
        number = float(value)
        if math.isnan(number):
            return default
        return number
    except Exception:
        return default


def compact_number(value: float) -> Any:
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return value


def normalize_part_no(raw_part_no: str) -> str:
    part_text = str(raw_part_no or "").strip().upper()
    if not part_text:
        return ""
    part_text = re.sub(r"\s+", "", part_text)
    if PART_NO_PATTERN.match(part_text):
        return part_text
    matches = PART_NO_FUZZY_PATTERN.findall(part_text)
    if matches:
        return max(matches, key=len)
    compact = re.sub(r"[^A-Z0-9]+", "", part_text)
    return compact


def has_alpha_part_alias(raw_part_no: Any) -> bool:
    alias_text = str(raw_part_no or "").strip().upper()
    if not alias_text:
        return False
    return bool(re.search(r"[A-Z]", alias_text))


def is_trusted_inventory_part_no(
    part_no: str,
    raw_part_no: Any = "",
    known_part_nos: Optional[Set[str]] = None,
) -> bool:
    normalized_part_no = normalize_part_no(part_no)
    if not normalized_part_no:
        return False
    if known_part_nos and normalized_part_no in known_part_nos:
        return True
    if not SUSPICIOUS_SHORT_NUMERIC_PART_PATTERN.match(normalized_part_no):
        return True
    return has_alpha_part_alias(raw_part_no)


def resolve_inventory_item_type(part_no: str, category_hint: str = "") -> str:
    code = str(part_no or "").strip()
    hint = str(category_hint or "").strip()
    if code.startswith(("1201", "1202")) or "半成品" in hint:
        return "semifinished"
    if code.startswith("1101") or "成品" in hint:
        return "finished_goods"
    return "raw_material"


def resolve_inventory_category_label(item_type: str) -> str:
    if item_type == "finished_goods":
        return "成品库存"
    if item_type == "semifinished":
        return "半成品库存"
    return "原材料库存"


def should_include_in_capacity(item_type: str) -> bool:
    return item_type != "finished_goods"


def finalize_inventory_dataset(inventory_rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    aggregated_rows = aggregate_inventory_rows(inventory_rows)
    inventory_items = build_inventory_items_from_rows(aggregated_rows)
    return {
        "items": inventory_items,
        "total_items": len(inventory_items),
        "inventory_rows": aggregated_rows,
        "inventory_row_count": len(aggregated_rows),
    }


def build_inventory_items_from_rows(inventory_rows: List[Dict[str, Any]]) -> Dict[str, float]:
    inventory: Dict[str, float] = {}
    for row in inventory_rows:
        raw_part_no = clean_text(row.get("part_no") or row.get("raw_part_no"))
        part_no = normalize_part_no(raw_part_no)
        if not part_no:
            continue
        item_type = str(
            row.get("item_type")
            or resolve_inventory_item_type(part_no, str(row.get("category", "")))
        )
        if not should_include_in_capacity(item_type):
            continue
        qty = to_number(
            row.get("good_qty"),
            to_number(row.get("quantity"), 0.0),
        )
        if qty <= 0:
            continue
        inventory[part_no] = inventory.get(part_no, 0.0) + qty
    return inventory


def aggregate_inventory_rows(inventory_rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    aggregated: Dict[str, Dict[str, Any]] = {}

    def merge_text(current: str, candidate: str) -> str:
        if not candidate:
            return current
        if not current:
            return candidate
        return candidate if len(candidate) > len(current) else current

    for row in inventory_rows:
        raw_part_no = clean_text(row.get("raw_part_no") or row.get("part_no"))
        canonical_part_no = normalize_part_no(raw_part_no)
        part_no = canonical_part_no or raw_part_no
        if not part_no:
            continue

        item_type = str(
            row.get("item_type")
            or resolve_inventory_item_type(part_no, str(row.get("category", "")))
        )
        bucket = aggregated.setdefault(
            part_no,
            {
                "part_no": part_no,
                "description": "",
                "good_qty": 0.0,
                "bad_qty": 0.0,
                "total_qty": 0.0,
                "quantity": 0.0,
                "sheet_names": set(),
                "warehouses": set(),
                "quality_classes": set(),
                "statuses": set(),
                "raw_part_nos": set(),
                "item_type": item_type,
            },
        )

        if item_type == "semifinished":
            bucket["item_type"] = "semifinished"
        elif item_type == "finished_goods" and bucket.get("item_type") == "raw_material":
            bucket["item_type"] = "finished_goods"

        description = clean_text(row.get("description"))
        bucket["description"] = merge_text(bucket.get("description", ""), description)

        good_qty = to_number(
            row.get("good_qty"),
            to_number(row.get("quantity"), 0.0),
        )
        bad_qty = to_number(row.get("bad_qty"), 0.0)
        total_qty = to_number(row.get("total_qty"), good_qty + bad_qty)
        quantity = to_number(row.get("quantity"), good_qty)

        bucket["good_qty"] += good_qty
        bucket["bad_qty"] += bad_qty
        bucket["total_qty"] += total_qty
        bucket["quantity"] += quantity

        sheet_name = clean_text(row.get("sheet_name"))
        warehouse = clean_text(row.get("warehouse"))
        quality_class = clean_text(row.get("quality_class"))
        status = clean_text(row.get("status"))
        if sheet_name:
            bucket["sheet_names"].add(sheet_name)
        if warehouse:
            bucket["warehouses"].add(warehouse)
        if quality_class:
            bucket["quality_classes"].add(quality_class)
        if status:
            bucket["statuses"].add(status)
        if raw_part_no:
            bucket["raw_part_nos"].add(raw_part_no)

    aggregated_rows: List[Dict[str, Any]] = []
    for part_no, bucket in aggregated.items():
        item_type = str(bucket.get("item_type") or "raw_material")
        aggregated_rows.append(
            {
                "raw_part_no": " / ".join(sorted(bucket["raw_part_nos"])) or part_no,
                "part_no": part_no,
                "description": bucket.get("description", ""),
                "good_qty": compact_number(float(bucket.get("good_qty", 0.0) or 0.0)),
                "bad_qty": compact_number(float(bucket.get("bad_qty", 0.0) or 0.0)),
                "total_qty": compact_number(float(bucket.get("total_qty", 0.0) or 0.0)),
                "quantity": compact_number(float(bucket.get("quantity", 0.0) or 0.0)),
                "sheet_name": " / ".join(sorted(bucket["sheet_names"])),
                "category": resolve_inventory_category_label(item_type),
                "warehouse": " / ".join(sorted(bucket["warehouses"])),
                "quality_class": " / ".join(sorted(bucket["quality_classes"])),
                "status": " / ".join(sorted(bucket["statuses"])),
                "item_type": item_type,
                "merged_row_count": len(bucket["raw_part_nos"]) or 1,
            }
        )

    aggregated_rows.sort(
        key=lambda item: (
            0 if str(item.get("item_type")) == "raw_material" else (
                1 if str(item.get("item_type")) == "semifinished" else 2
            ),
            str(item.get("part_no", "")),
        )
    )
    return aggregated_rows


def find_col(df: pd.DataFrame, keywords: List[str]) -> Optional[Any]:
    for col in df.columns:
        col_name = str(col).strip()
        if any(keyword in col_name for keyword in keywords):
            return col
    return None


def parse_material_summary_sheet(df: pd.DataFrame) -> Optional[Dict[str, Any]]:
    part_col = find_col(df, ["货号", "机型(品号)", "物料", "编码", "Part"])
    good_col = find_col(df, ["良品", "可用", "库存", "Quantity", "Qty", "台数"])
    desc_col = find_col(df, ["描述", "品名", "物料名称", "名称"])
    bad_col = find_col(df, ["不良"])
    total_col = find_col(df, ["合计", "总计"])

    if part_col is None or good_col is None:
        return None

    inventory_rows = []
    for _, row in df.iterrows():
        raw_part_no = clean_text(row.get(part_col))
        if not raw_part_no:
            continue

        part_no = normalize_part_no(raw_part_no)
        description = clean_text(row.get(desc_col)) if desc_col is not None else ""
        good_qty = to_number(row.get(good_col), 0.0)
        bad_qty = to_number(row.get(bad_col), 0.0) if bad_col is not None else 0.0
        total_qty = to_number(row.get(total_col), good_qty + bad_qty) if total_col is not None else (good_qty + bad_qty)
        item_type = resolve_inventory_item_type(part_no or raw_part_no)

        inventory_rows.append(
            {
                "raw_part_no": raw_part_no,
                "part_no": part_no or raw_part_no,
                "description": description,
                "good_qty": compact_number(good_qty),
                "bad_qty": compact_number(bad_qty),
                "total_qty": compact_number(total_qty),
                "quantity": compact_number(good_qty),
                "sheet_name": "材料汇总表",
                "category": resolve_inventory_category_label(item_type),
                "warehouse": "",
                "quality_class": "",
                "item_type": item_type,
            }
        )
    return finalize_inventory_dataset(inventory_rows)


def parse_finished_goods_detail_sheet(df: pd.DataFrame) -> List[Dict[str, Any]]:
    part_col = find_col(df, ["机型(品号)", "货号", "品号", "编码", "Part"])
    qty_col = find_col(df, ["台数", "数量", "Quantity", "Qty"])
    desc_col = find_col(df, ["品名", "描述", "名称"])
    category_col = find_col(df, ["类别"])
    warehouse_col = find_col(df, ["仓别"])
    quality_col = find_col(df, ["品质类别"])
    status_col = find_col(df, ["状态"])

    if part_col is None or qty_col is None or category_col is None:
        return []

    aggregated: Dict[str, Dict[str, Any]] = {}
    allowed_categories = {"成品", "半成品"}

    for _, row in df.iterrows():
        category = clean_text(row.get(category_col))
        if category not in allowed_categories:
            continue

        raw_part_no = clean_text(row.get(part_col))
        if not raw_part_no:
            continue

        part_no = normalize_part_no(raw_part_no)
        description = clean_text(row.get(desc_col))
        qty = to_number(row.get(qty_col), 0.0)
        warehouse = clean_text(row.get(warehouse_col)) if warehouse_col is not None else ""
        quality_class = clean_text(row.get(quality_col)) if quality_col is not None else ""
        status = clean_text(row.get(status_col)) if status_col is not None else ""
        item_type = resolve_inventory_item_type(part_no or raw_part_no, category)
        is_bad_quality = "不良" in quality_class

        key = part_no or raw_part_no
        if not key:
            continue

        row_entry = aggregated.setdefault(
            key,
            {
                "raw_part_no": raw_part_no,
                "part_no": key,
                "description": description,
                "good_qty": 0.0,
                "bad_qty": 0.0,
                "total_qty": 0.0,
                "quantity": 0.0,
                "sheet_name": "成品明细表",
                "category": resolve_inventory_category_label(item_type),
                "warehouse": set(),
                "quality_class": set(),
                "status": set(),
                "item_type": item_type,
            },
        )
        if is_bad_quality:
            row_entry["bad_qty"] += qty
        else:
            row_entry["good_qty"] += qty
        row_entry["total_qty"] += qty
        row_entry["quantity"] += 0.0 if is_bad_quality else qty
        if warehouse:
            row_entry["warehouse"].add(warehouse)
        if quality_class:
            row_entry["quality_class"].add(quality_class)
        if status:
            row_entry["status"].add(status)
        if not row_entry.get("description") and description:
            row_entry["description"] = description

    finished_rows: List[Dict[str, Any]] = []
    for row in aggregated.values():
        finished_rows.append(
            {
                "raw_part_no": row["raw_part_no"],
                "part_no": row["part_no"],
                "description": row.get("description", ""),
                "good_qty": compact_number(row["good_qty"]),
                "bad_qty": compact_number(row["bad_qty"]),
                "total_qty": compact_number(row["total_qty"]),
                "quantity": compact_number(row["quantity"]),
                "sheet_name": row["sheet_name"],
                "category": row["category"],
                "warehouse": " / ".join(sorted(row["warehouse"])),
                "quality_class": " / ".join(sorted(row["quality_class"])),
                "status": " / ".join(sorted(row["status"])),
                "item_type": row["item_type"],
            }
        )

    finished_rows.sort(key=lambda item: str(item.get("part_no", "")))
    return finished_rows


def parse_excel_attachment(file_content: bytes, filename: str) -> Dict[str, Any]:
    try:
        inventory_rows = []
        engine = "xlrd" if filename.endswith(".xls") else ("openpyxl" if filename.endswith(".xlsx") else None)

        if filename.endswith(".csv"):
            df = pd.read_csv(io.BytesIO(file_content))
            excel_file = None
        else:
            excel_file = pd.ExcelFile(io.BytesIO(file_content), engine=engine)
            sheet_name = "材料汇总表" if "材料汇总表" in excel_file.sheet_names else 0
            df = pd.read_excel(excel_file, sheet_name=sheet_name)

        summary_result = parse_material_summary_sheet(df)
        if summary_result is not None:
            if excel_file is not None and "成品明细表" in excel_file.sheet_names:
                finished_df = pd.read_excel(excel_file, sheet_name="成品明细表")
                finished_rows = parse_finished_goods_detail_sheet(finished_df)
                if finished_rows:
                    combined_rows = list(summary_result.get("inventory_rows") or [])
                    combined_rows.extend(finished_rows)
                    summary_result.update(finalize_inventory_dataset(combined_rows))
                    summary_result["finished_inventory_rows"] = [
                        row for row in summary_result.get("inventory_rows", [])
                        if str(row.get("item_type", "")) == "finished_goods"
                    ]
                    summary_result["finished_inventory_count"] = len(summary_result["finished_inventory_rows"])
                    summary_result["semifinished_inventory_rows"] = [
                        row for row in summary_result.get("inventory_rows", [])
                        if str(row.get("item_type", "")) == "semifinished"
                    ]
                    summary_result["semifinished_inventory_count"] = len(summary_result["semifinished_inventory_rows"])
            return summary_result

        part_col = None
        qty_col = None
        desc_col = None

        for col in df.columns:
            col_name = str(col).strip()
            if any(k in col_name for k in ["货号", "物料", "编码", "Part"]):
                part_col = col
            if any(k in col_name for k in ["描述", "品名", "物料名称", "名称"]):
                desc_col = col
            if any(k in col_name for k in ["良品", "可用", "库存", "Quantity", "Qty"]):
                qty_col = col

        if part_col is None or qty_col is None:
            for col in df.columns:
                if df[col].astype(str).str.contains(r"\d{4,15}", regex=True).any():
                    part_col = col
                    break
            if part_col is not None:
                cols_list = df.columns.tolist()
                start_idx = cols_list.index(part_col)
                for i in range(start_idx + 1, len(cols_list)):
                    if pd.api.types.is_numeric_dtype(df[cols_list[i]]):
                        qty_col = cols_list[i]
                        break

        if part_col is None or qty_col is None:
            return {"error": "Could not identify Part Number or Quantity columns in the attachment"}

        for _, row in df.iterrows():
            raw_part_no = clean_text(row.get(part_col))
            if not raw_part_no:
                continue
            part_no = normalize_part_no(raw_part_no)
            qty = to_number(row.get(qty_col), 0.0)
            description = clean_text(row.get(desc_col)) if desc_col is not None else ""

            inventory_rows.append(
                {
                    "raw_part_no": raw_part_no,
                    "part_no": part_no or raw_part_no,
                    "description": description,
                    "good_qty": compact_number(qty),
                    "bad_qty": 0,
                    "total_qty": compact_number(qty),
                    "quantity": compact_number(qty),
                    "sheet_name": "附件导入",
                    "category": resolve_inventory_category_label(
                        resolve_inventory_item_type(part_no or raw_part_no)
                    ),
                    "warehouse": "",
                    "quality_class": "",
                    "item_type": resolve_inventory_item_type(part_no or raw_part_no),
                }
            )

        return finalize_inventory_dataset(inventory_rows)
    except Exception as exc:
        logger.error("Failed to parse target Excel file %s: %s", filename, exc)
        import traceback

        logger.error(traceback.format_exc())
        return {"error": str(exc)}
