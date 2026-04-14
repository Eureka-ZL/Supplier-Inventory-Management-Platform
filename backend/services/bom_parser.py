import os
import re
import logging
from typing import Any, Dict, List, Optional

import pandas as pd

logger = logging.getLogger(__name__)

HEADER_KEYWORDS = {
    "子项物料代码",
    "美图码",
    "物料代码",
    "物料名称",
    "规格型号",
    "规格描述",
    "用量",
    "单位用量",
    "厂家",
}

SKIP_SHEETS = {"签批", "更改记录"}
HEADER_SKIP_VALUES = {"顺序号", "子项物料代码", "物料代码", "美图码", "BOM代码"}
PRODUCT_CODE_PATTERN = re.compile(r"\d{6,15}")
FILENAME_CODE_PATTERN = re.compile(r"[-_]?\(?(\d{10,15})\)?")


def _clean(value: Any) -> str:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return ""
    text = str(value).strip()
    if text in {"nan", "NaN", "None"}:
        return ""
    return text


def _to_float(value: Any) -> Optional[float]:
    try:
        if value is None or (isinstance(value, float) and pd.isna(value)):
            return None
        text = _clean(value).replace(",", "")
        if not text:
            return None
        return float(text)
    except Exception:
        return None


def _looks_like_product_code(value: str) -> bool:
    if not value:
        return False
    compact = value.replace("-", "")
    return compact.isdigit() or bool(PRODUCT_CODE_PATTERN.search(value))


def _find_section_starts(df: pd.DataFrame) -> List[int]:
    starts: List[int] = []
    max_cols = min(df.shape[1], 10)
    for ri in range(df.shape[0]):
        row_vals = [_clean(df.iloc[ri, ci]) for ci in range(max_cols)]
        if "BOM代码" in row_vals and any(v in row_vals for v in ("物料代码", "美图码")):
            starts.append(ri)
    return starts


def _find_header_row(df: pd.DataFrame, start: int, end: int) -> Optional[int]:
    header_row_idx: Optional[int] = None
    best_match_count = 0
    scan_end = min(end, start + 20)

    for ri in range(start, scan_end):
        row_vals = set()
        for ci in range(df.shape[1]):
            row_vals.add(_clean(df.iloc[ri, ci]))
        match_count = len(row_vals & HEADER_KEYWORDS)
        if match_count >= 2 and match_count > best_match_count:
            best_match_count = match_count
            header_row_idx = ri

    return header_row_idx


def _extract_product_info(
    df: pd.DataFrame,
    start: int,
    header_row_idx: int,
    filepath: str,
    sheet_name: str,
    section_index: int,
) -> Dict[str, str]:
    product_code = ""
    product_name = ""

    for ri in range(start + 1, header_row_idx):
        code_candidate = _clean(df.iloc[ri, 1]) if df.shape[1] > 1 else ""
        name_candidate = _clean(df.iloc[ri, 2]) if df.shape[1] > 2 else ""

        if (
            code_candidate
            and code_candidate not in HEADER_SKIP_VALUES
            and _looks_like_product_code(code_candidate)
        ):
            product_code = code_candidate
            product_name = name_candidate
            break

        merged_candidate = _clean(df.iloc[ri, 0]) if df.shape[1] > 0 else ""
        if merged_candidate and merged_candidate not in HEADER_SKIP_VALUES:
            for sep in ("：", ":"):
                if sep in merged_candidate:
                    left, right = merged_candidate.rsplit(sep, 1)
                    right = right.strip()
                    if _looks_like_product_code(right):
                        product_name = left.strip()
                        product_code = right
                        break
            if product_code:
                break

    if not product_code:
        base_name = os.path.basename(filepath).replace(".xlsx", "").replace(".xls", "")
        match = FILENAME_CODE_PATTERN.search(base_name)
        if match:
            product_code = match.group(1)

    if not product_name:
        if product_code:
            product_name = f"{sheet_name}_{product_code}" if section_index > 1 else os.path.basename(filepath).replace(".xlsx", "").replace(".xls", "")
        else:
            product_name = f"{sheet_name}_{section_index}"

    return {"product_code": product_code, "product_name": product_name}


def _build_col_map(header_row: pd.Series) -> Dict[str, int]:
    col_map: Dict[str, int] = {}
    for ci, val in enumerate(header_row):
        v = _clean(val)
        if v in ("子项物料代码", "美图码", "物料代码"):
            col_map["part_no"] = ci
        elif v == "物料名称":
            col_map["name"] = ci
        elif v in ("规格型号", "规格描述"):
            col_map["spec"] = ci
        elif v in ("用量", "单位用量"):
            col_map["qty"] = ci
        elif v == "厂家":
            col_map["manufacturer"] = ci
    return col_map


def _parse_section_parts(
    df: pd.DataFrame, header_row_idx: int, end: int, col_map: Dict[str, int]
) -> List[Dict[str, Any]]:
    parts: List[Dict[str, Any]] = []
    alt_group_counter = 0
    last_main_idx: Optional[int] = None
    last_main_qty: float = 1.0

    for ri in range(header_row_idx + 1, end):
        row = df.iloc[ri]

        part_col = col_map.get("part_no", 1)
        part_no = _clean(row[part_col]) if part_col < len(row) else ""
        if not part_no or part_no in HEADER_SKIP_VALUES:
            continue

        name_col = col_map.get("name", 2)
        spec_col = col_map.get("spec", 3)
        mfr_col = col_map.get("manufacturer", -1)
        qty_col = col_map.get("qty", -1)

        name = _clean(row[name_col]) if name_col < len(row) else ""
        spec = _clean(row[spec_col]) if spec_col < len(row) else ""
        manufacturer = _clean(row[mfr_col]) if mfr_col >= 0 and mfr_col < len(row) else ""
        qty = _to_float(row[qty_col]) if qty_col >= 0 and qty_col < len(row) else None

        seq_val = _clean(row[0]) if len(row) > 0 else ""
        is_alternative = not seq_val

        alt_group = None
        if is_alternative and last_main_idx is not None:
            alt_group_counter += 1
            alt_group = alt_group_counter
            if parts[last_main_idx].get("alt_group") is None:
                parts[last_main_idx]["alt_group"] = alt_group
            else:
                alt_group = parts[last_main_idx]["alt_group"]
            if qty is None:
                qty = last_main_qty

        if qty is None:
            qty = 1.0

        part_entry = {
            "part_no": part_no,
            "name": name,
            "spec": spec,
            "qty": qty,
            "manufacturer": manufacturer,
            "alt_group": alt_group,
        }
        parts.append(part_entry)

        if not is_alternative:
            last_main_idx = len(parts) - 1
            last_main_qty = qty

    return parts


def _parse_sheet_sections(
    df: pd.DataFrame, filepath: str, sheet_name: str
) -> List[Dict[str, Any]]:
    products: List[Dict[str, Any]] = []
    section_starts = _find_section_starts(df)

    if not section_starts:
        section_starts = [0]

    for idx, start in enumerate(section_starts):
        end = section_starts[idx + 1] if idx + 1 < len(section_starts) else df.shape[0]
        if end - start < 3:
            continue

        header_row_idx = _find_header_row(df, start, end)
        if header_row_idx is None:
            continue

        product_info = _extract_product_info(
            df,
            start=start,
            header_row_idx=header_row_idx,
            filepath=filepath,
            sheet_name=sheet_name,
            section_index=idx + 1,
        )
        col_map = _build_col_map(df.iloc[header_row_idx])
        parts = _parse_section_parts(df, header_row_idx, end, col_map)
        if not parts:
            continue

        products.append(
            {
                "product_code": product_info["product_code"],
                "product_name": product_info["product_name"],
                "total_parts": len(parts),
                "parts": parts,
                "sheet": sheet_name,
            }
        )

    return products


def parse_bom_products_from_file(filepath: str) -> List[Dict[str, Any]]:
    products: List[Dict[str, Any]] = []
    engine = "xlrd" if filepath.lower().endswith(".xls") else "openpyxl"
    try:
        xl = pd.ExcelFile(filepath, engine=engine)
    except Exception as exc:
        logger.warning(f"Failed to open BOM file {filepath}: {exc}")
        return products

    for sheet_name in xl.sheet_names:
        if sheet_name in SKIP_SHEETS:
            continue
        try:
            df = pd.read_excel(xl, sheet_name=sheet_name, header=None)
        except Exception as exc:
            logger.warning(f"Failed to read sheet {sheet_name} in {filepath}: {exc}")
            continue

        if df.shape[0] < 3:
            continue

        sheet_products = _parse_sheet_sections(df, filepath, sheet_name)
        products.extend(sheet_products)

    return products
