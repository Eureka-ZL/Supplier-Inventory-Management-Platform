import glob
import math
import logging
from typing import Dict, Any, Optional, List, Set
from services.bom_parser import parse_bom_products_from_file
from services.inventory_excel_parser import (
    compact_number,
    is_trusted_inventory_part_no,
    normalize_part_no,
    parse_excel_attachment as parse_inventory_excel_attachment,
    resolve_inventory_item_type,
    should_include_in_capacity,
    to_number,
)
import os

logger = logging.getLogger(__name__)
EPSILON = 1e-9

class InventoryParser:
    def __init__(
        self,
        bom_dir: str = "bom",
        bom_overrides: Optional[Dict[str, Dict[str, Any]]] = None,
        bom_products: Optional[List[Dict[str, Any]]] = None,
    ):
        self.bom_dir = os.path.join(os.getcwd(), bom_dir)
        self.bom_overrides = bom_overrides or {}
        self.bom_products = bom_products or []
        # Attempt to load bom_dir from project root if it exists
        project_root = os.path.dirname(os.getcwd())
        if os.path.exists(os.path.join(project_root, bom_dir)):
            self.bom_dir = os.path.join(project_root, bom_dir)

    def _extract_bom_models(self) -> Dict[str, Dict[str, Any]]:
        """
        Recursively scans all BOM excel files and returns per-product models:
        {
          product_key: {
            fixed_parts: {part_no: required_qty},
            alternative_groups: [
              {group_id: str, options: [{part_no, required_qty}]}
            ]
          }
        }

        Business rule: options inside one alternative group are interchangeable
        but cannot be mixed in one product build.
        """
        bom_models: Dict[str, Dict[str, Any]] = {}
        source_products = self.bom_products if self.bom_products else self._load_bom_products_from_filesystem()

        for product in source_products:
            fixed_parts: Dict[str, float] = {}
            alt_groups: Dict[str, Dict[str, float]] = {}
            part_meta: Dict[str, Dict[str, str]] = {}

            for part in product.get("parts", []):
                raw_part_no = str(part.get("part_no", "")).strip()
                part_no = self._normalize_part_no(raw_part_no)
                if not part_no:
                    continue

                req_qty = self._to_number(part.get("qty"), 0.0)
                if req_qty <= 0:
                    continue

                meta = part_meta.setdefault(part_no, {"name": "", "spec": "", "manufacturer": ""})
                name = str(part.get("name", "") or "").strip()
                spec = str(part.get("spec", "") or "").strip()
                manufacturer = str(part.get("manufacturer", "") or "").strip()
                if name and not meta.get("name"):
                    meta["name"] = name
                if spec and not meta.get("spec"):
                    meta["spec"] = spec
                if manufacturer and not meta.get("manufacturer"):
                    meta["manufacturer"] = manufacturer

                alt_group = part.get("alt_group")
                if alt_group is None:
                    fixed_parts[part_no] = fixed_parts.get(part_no, 0.0) + req_qty
                else:
                    group_id = str(alt_group)
                    if group_id not in alt_groups:
                        alt_groups[group_id] = {}
                    alt_groups[group_id][part_no] = alt_groups[group_id].get(part_no, 0.0) + req_qty

            if not fixed_parts and not alt_groups:
                continue

            product_name = str(product.get("product_name", "")).strip()
            product_code = str(product.get("product_code", "")).strip()
            if product_name and product_code:
                key = f"{product_name} ({product_code})"
            elif product_name:
                key = product_name
            else:
                key = str(product.get("source_file") or product.get("file") or "未命名BOM")

            unique_key = key
            suffix = 2
            while unique_key in bom_models:
                unique_key = f"{key} #{suffix}"
                suffix += 1

            alternative_groups = []
            for group_id, options in alt_groups.items():
                option_list = []
                for option_part_no, option_req_qty in options.items():
                    option_list.append(
                        {"part_no": option_part_no, "required_qty": option_req_qty}
                    )
                alternative_groups.append(
                    {"group_id": group_id, "options": option_list}
                )

            bom_models[unique_key] = {
                "product_name": product_name,
                "product_code": product_code,
                "fixed_parts": fixed_parts,
                "alternative_groups": alternative_groups,
                "part_meta": part_meta,
                "line": str(product.get("line") or product.get("category") or "未分类"),
                "source_file": str(product.get("source_file") or product.get("file") or ""),
                "is_finished_product": bool(product.get("is_finished_product", False)),
            }

        if not any(bool(model.get("is_finished_product")) for model in bom_models.values()):
            self._mark_finished_products(bom_models)
        return bom_models

    def _load_bom_products_from_filesystem(self) -> List[Dict[str, Any]]:
        products: List[Dict[str, Any]] = []
        if not os.path.exists(self.bom_dir):
            logger.warning("BOM directory not found at %s", self.bom_dir)
            return products

        excel_files = glob.glob(os.path.join(self.bom_dir, "**/*.xlsx"), recursive=True)
        for file_path in excel_files:
            if "~$" in file_path:
                continue
            try:
                parsed_products = parse_bom_products_from_file(file_path)
            except Exception as e:
                logger.error("Failed to process BOM file %s: %s", file_path, e)
                continue

            for product in parsed_products:
                product_code_raw = str(product.get("product_code", "")).strip()
                override_parts = None
                if product_code_raw and product_code_raw in self.bom_overrides:
                    override_entry = self.bom_overrides.get(product_code_raw) or {}
                    candidate_parts = override_entry.get("parts") if isinstance(override_entry, dict) else None
                    if isinstance(candidate_parts, list):
                        override_parts = candidate_parts
                products.append(
                    {
                        "product_code": str(product.get("product_code", "")).strip(),
                        "product_name": str(product.get("product_name", "")).strip(),
                        "line": os.path.basename(os.path.dirname(file_path)).strip() or "未分类",
                        "source_file": os.path.basename(file_path),
                        "parts": override_parts if override_parts is not None else (product.get("parts", []) or []),
                    }
                )
        return products

    def _build_product_code_index(
        self, bom_models: Dict[str, Dict[str, Any]]
    ) -> Dict[str, Dict[str, Any]]:
        code_index: Dict[str, Dict[str, Any]] = {}
        for _, model in bom_models.items():
            product_code = self._normalize_part_no(str(model.get("product_code", "")).strip())
            if not product_code:
                continue
            if product_code not in code_index:
                code_index[product_code] = model
        return code_index

    def _mark_finished_products(self, bom_models: Dict[str, Dict[str, Any]]) -> None:
        if not bom_models:
            return
        code_index = self._build_product_code_index(bom_models)
        if not code_index:
            return

        referenced_codes: Set[str] = set()
        for _, model in bom_models.items():
            for part_no in model.get("fixed_parts", {}).keys():
                if part_no in code_index:
                    referenced_codes.add(part_no)
            for group in model.get("alternative_groups", []):
                for option in group.get("options", []):
                    part_no = str(option.get("part_no", "")).strip()
                    if part_no in code_index:
                        referenced_codes.add(part_no)

        root_codes = [code for code in code_index.keys() if code not in referenced_codes]
        final_codes = [code for code in root_codes if code.startswith("1101")]
        finished_code_set = set(final_codes if final_codes else root_codes)

        for _, model in bom_models.items():
            product_code = self._normalize_part_no(str(model.get("product_code", "")).strip())
            model["is_finished_product"] = bool(product_code and product_code in finished_code_set)

    def _get_finished_models(
        self, bom_models: Dict[str, Dict[str, Any]]
    ) -> Dict[str, Dict[str, Any]]:
        finished = {k: v for k, v in bom_models.items() if bool(v.get("is_finished_product"))}
        if finished:
            return finished
        # Fallback for legacy/abnormal datasets: keep all models.
        return dict(bom_models)

    def _build_part_meta_index(
        self, bom_models: Dict[str, Dict[str, Any]]
    ) -> Dict[str, Dict[str, str]]:
        meta_index: Dict[str, Dict[str, str]] = {}
        for _, model in bom_models.items():
            for part_no, meta in (model.get("part_meta", {}) or {}).items():
                row = meta_index.setdefault(str(part_no), {"name": "", "spec": "", "manufacturer": ""})
                if not isinstance(meta, dict):
                    continue
                for field in ("name", "spec", "manufacturer"):
                    value = str(meta.get(field, "") or "").strip()
                    if value and not row.get(field):
                        row[field] = value
        return meta_index

    def _build_known_bom_part_set(
        self, bom_models: Dict[str, Dict[str, Any]]
    ) -> Set[str]:
        known_part_nos: Set[str] = set()
        for _, model in bom_models.items():
            product_code = self._normalize_part_no(str(model.get("product_code", "")).strip())
            if product_code:
                known_part_nos.add(product_code)
            for part_no in (model.get("fixed_parts") or {}).keys():
                normalized = self._normalize_part_no(str(part_no).strip())
                if normalized:
                    known_part_nos.add(normalized)
            for group in (model.get("alternative_groups") or []):
                for option in (group.get("options") or []):
                    normalized = self._normalize_part_no(str(option.get("part_no", "")).strip())
                    if normalized:
                        known_part_nos.add(normalized)
        return known_part_nos

    def _rebuild_trusted_inventory_items(
        self,
        parsed_data: Dict[str, Any],
    ) -> Dict[str, Any]:
        inventory_rows = parsed_data.get("inventory_rows") or []
        if not isinstance(inventory_rows, list) or not inventory_rows:
            return parsed_data

        bom_models_all = self._extract_bom_models()
        known_part_nos = self._build_known_bom_part_set(bom_models_all)
        trusted_items: Dict[str, float] = {}
        trusted_rows: List[Dict[str, Any]] = []
        excluded_rows: List[Dict[str, Any]] = []

        for row in inventory_rows:
            if not isinstance(row, dict):
                continue
            raw_part_no = str(row.get("raw_part_no") or row.get("part_no") or "").strip()
            part_no = self._normalize_part_no(raw_part_no)
            if not part_no:
                continue

            item_type = str(
                row.get("item_type")
                or resolve_inventory_item_type(part_no, str(row.get("category", "")))
            )
            if not should_include_in_capacity(item_type):
                continue

            qty = self._to_number(
                row.get("good_qty"),
                self._to_number(row.get("quantity"), 0.0),
            )
            if qty <= 0:
                continue

            if is_trusted_inventory_part_no(
                part_no,
                raw_part_no=raw_part_no,
                known_part_nos=known_part_nos,
            ):
                trusted_rows.append(dict(row))
                trusted_items[part_no] = trusted_items.get(part_no, 0.0) + qty
                continue

            excluded_rows.append(
                {
                    "part_no": part_no,
                    "raw_part_no": raw_part_no,
                    "description": str(row.get("description", "") or "").strip(),
                    "good_qty": self._compact_number(qty),
                    "item_type": item_type,
                    "reason": "suspicious_short_numeric_part_no",
                }
            )

        normalized_items = {
            key: self._compact_number(value)
            for key, value in trusted_items.items()
        }
        filtered_data = dict(parsed_data)
        filtered_data["items"] = normalized_items
        filtered_data["total_items"] = len(normalized_items)
        filtered_data["unique_part_count"] = len(normalized_items)
        filtered_data["inventory_rows"] = trusted_rows
        filtered_data["inventory_row_count"] = len(trusted_rows)
        if "finished_inventory_rows" in filtered_data:
            filtered_data["finished_inventory_rows"] = [
                row for row in trusted_rows
                if str(row.get("item_type", "")) == "finished_goods"
            ]
            filtered_data["finished_inventory_count"] = len(filtered_data["finished_inventory_rows"])
        if "semifinished_inventory_rows" in filtered_data:
            filtered_data["semifinished_inventory_rows"] = [
                row for row in trusted_rows
                if str(row.get("item_type", "")) == "semifinished"
            ]
            filtered_data["semifinished_inventory_count"] = len(filtered_data["semifinished_inventory_rows"])
        filtered_data["excluded_inventory_rows"] = excluded_rows
        filtered_data["excluded_inventory_count"] = len(excluded_rows)
        return filtered_data

    def sanitize_inventory_dataset(self, parsed_data: Dict[str, Any]) -> Dict[str, Any]:
        return self._rebuild_trusted_inventory_items(parsed_data)

    @staticmethod
    def _resolve_bom_tier(product_code: str) -> str:
        code = str(product_code or "").strip()
        if code.startswith("1101"):
            return "finished"
        if code.startswith("1201"):
            return "head"
        if code.startswith("1202"):
            return "pcba"
        return "other"

    @staticmethod
    def _resolve_bom_tier_label(tier: str) -> str:
        if tier == "finished":
            return "成品机BOM"
        if tier == "head":
            return "机头BOM"
        if tier == "pcba":
            return "PCBA BOM"
        return "其他层级BOM"

    def evaluate_product_capacity(
        self,
        product_name: str,
        product_model: Dict[str, Any],
        inv_items: Dict[str, float],
        bom_code_index: Optional[Dict[str, Dict[str, Any]]] = None,
        part_meta_index: Optional[Dict[str, Dict[str, str]]] = None,
    ) -> Dict[str, Any]:
        """
        Evaluate capacity for one product.
        In planning mode, product can recursively consume sub-assembly BOMs.
        """
        part_meta_index = part_meta_index or {}
        product_code = self._normalize_part_no(str(product_model.get("product_code", "")).strip())
        include_self_inventory = bool(product_code and not bool(product_model.get("is_finished_product")))
        direct_inventory_units = 0
        working_stock: Dict[str, float] = {str(k): float(v) for k, v in inv_items.items()}
        if include_self_inventory:
            direct_inventory_units = max(0, int(float(working_stock.get(product_code, 0.0)) // 1))
            if direct_inventory_units > 0:
                working_stock[product_code] = max(0.0, float(working_stock.get(product_code, 0.0)) - direct_inventory_units)

        trace_rows: List[Dict[str, Any]] = []
        first_plan = self._build_one_unit_consumption(
            product_model,
            working_stock,
            bom_code_index=bom_code_index,
            trace_rows=trace_rows,
        )
        if first_plan is None:
            # Still expose full leaf-material detail for 0-capacity products.
            # Build one unit plan with virtual sufficient stock to get the
            # recursive consumption structure (finished -> head -> pcba -> leaf materials).
            reference_stock: Dict[str, float] = {}
            if bom_code_index:
                for code, model in bom_code_index.items():
                    reference_stock[code] = 10 ** 9
                    for part_no in (model.get("fixed_parts") or {}).keys():
                        reference_stock[str(part_no)] = 10 ** 9
                    for group in (model.get("alternative_groups") or []):
                        for option in (group.get("options") or []):
                            part_no = str(option.get("part_no", "")).strip()
                            if part_no:
                                reference_stock[part_no] = 10 ** 9
            if not reference_stock:
                for part_no in (product_model.get("fixed_parts") or {}).keys():
                    reference_stock[str(part_no)] = 10 ** 9
                for group in (product_model.get("alternative_groups") or []):
                    for option in (group.get("options") or []):
                        part_no = str(option.get("part_no", "")).strip()
                        if part_no:
                            reference_stock[part_no] = 10 ** 9

            trace_rows = []
            first_plan = self._build_one_unit_consumption(
                product_model,
                reference_stock,
                bom_code_index=bom_code_index,
                trace_rows=trace_rows,
            )
            if first_plan is None:
                return {
                    "product": product_name,
                    "line": str(product_model.get("line", "未分类")),
                    "source_file": str(product_model.get("source_file", "")),
                    "capacity": direct_inventory_units,
                    "bottleneck": "全体缺料",
                    "parts": [],
                    "bom_layers": [],
                }

        # Simulate one-by-one build for an accurate upper bound under recursive BOM choices.
        sim_stock: Dict[str, float] = dict(working_stock)
        product_capacity = direct_inventory_units
        max_simulation_steps = 300000
        while product_capacity < max_simulation_steps:
            unit_plan = self._build_one_unit_consumption(
                product_model,
                sim_stock,
                bom_code_index=bom_code_index,
            )
            if unit_plan is None:
                break
            for part_no, req_qty in (unit_plan.get("consumption") or {}).items():
                sim_stock[part_no] = float(sim_stock.get(part_no, 0.0)) - float(req_qty)
            product_capacity += 1

        parts_detail = []
        bottleneck_label = "全体缺料"
        bottleneck_capacity = None
        for part_no, req_qty in sorted((first_plan.get("consumption") or {}).items()):
            if req_qty <= 0:
                continue
            avail = float(inv_items.get(part_no, 0.0))
            can_produce = int(avail // req_qty)
            if bottleneck_capacity is None or can_produce < bottleneck_capacity:
                bottleneck_capacity = can_produce
                bottleneck_label = str(part_no)
            meta = part_meta_index.get(str(part_no), {})
            parts_detail.append(
                {
                    "part_no": str(part_no),
                    "required_qty": float(req_qty),
                    "available_qty": avail,
                    "can_produce": can_produce,
                    "is_bottleneck": False,
                    "part_type": "fixed",
                    "name": str(meta.get("name", "") or ""),
                    "spec": str(meta.get("spec", "") or ""),
                    "manufacturer": str(meta.get("manufacturer", "") or ""),
                }
            )
        if bottleneck_capacity is not None and parts_detail:
            bottleneck_parts = [row for row in parts_detail if int(row.get("can_produce", 0)) == int(bottleneck_capacity)]
            for detail in bottleneck_parts:
                detail["is_bottleneck"] = True
            if len(bottleneck_parts) == 1:
                bottleneck_label = str(bottleneck_parts[0].get("part_no", "全体缺料"))
            elif len(bottleneck_parts) > 1:
                first_part_no = str(bottleneck_parts[0].get("part_no", "") or "")
                bottleneck_label = f"{first_part_no} 等{len(bottleneck_parts)}项并列瓶颈"

        layer_rows_map: Dict[str, Dict[str, Any]] = {}
        for row in trace_rows:
            tier = str(row.get("tier", "other") or "other")
            tier_label = str(row.get("tier_label", self._resolve_bom_tier_label(tier)) or self._resolve_bom_tier_label(tier))
            part_no = str(row.get("part_no", "")).strip()
            req_qty = float(row.get("required_qty", 0.0) or 0.0)
            if not part_no or req_qty <= 0:
                continue
            is_subassembly = bool(row.get("is_subassembly"))
            layer_key = tier
            if layer_key not in layer_rows_map:
                layer_rows_map[layer_key] = {
                    "tier": tier,
                    "label": tier_label,
                    "part_count": 0,
                    "per_unit_total_qty": 0.0,
                    "rows": {},
                }
            layer_bucket = layer_rows_map[layer_key]
            rows_map: Dict[str, Any] = layer_bucket["rows"]
            if part_no not in rows_map:
                meta = dict(part_meta_index.get(part_no, {}) or {})
                if is_subassembly and (not meta.get("name")):
                    child_model = (bom_code_index or {}).get(part_no) if bom_code_index else None
                    if child_model is not None:
                        meta["name"] = str(child_model.get("product_name", "") or "")
                        meta["spec"] = str(child_model.get("product_code", "") or "")
                rows_map[part_no] = {
                    "part_no": part_no,
                    "name": str(meta.get("name", "") or ""),
                    "spec": str(meta.get("spec", "") or ""),
                    "manufacturer": str(meta.get("manufacturer", "") or ""),
                    "required_qty": 0.0,
                    "is_subassembly": is_subassembly,
                }
            rows_map[part_no]["required_qty"] += req_qty
            rows_map[part_no]["is_subassembly"] = bool(rows_map[part_no]["is_subassembly"] or is_subassembly)
            layer_bucket["per_unit_total_qty"] += req_qty

        layer_order = {"finished": 1, "head": 2, "pcba": 3, "other": 9}
        bom_layers: List[Dict[str, Any]] = []
        for layer in sorted(layer_rows_map.values(), key=lambda item: (layer_order.get(str(item.get("tier", "")), 99), str(item.get("label", "")))):
            rows_map: Dict[str, Any] = layer.get("rows", {})
            layer_rows = sorted(
                rows_map.values(),
                key=lambda row: (0 if bool(row.get("is_subassembly")) else 1, str(row.get("part_no", ""))),
            )
            bom_layers.append(
                {
                    "tier": layer.get("tier", "other"),
                    "label": layer.get("label", "其他层级BOM"),
                    "part_count": len(layer_rows),
                    "per_unit_total_qty": float(layer.get("per_unit_total_qty", 0.0)),
                    "rows": layer_rows,
                }
            )

        return {
            "product": product_name,
            "line": str(product_model.get("line", "未分类")),
            "source_file": str(product_model.get("source_file", "")),
            "capacity": product_capacity,
            "bottleneck": bottleneck_label,
            "parts": parts_detail,
            "bom_layers": bom_layers,
        }

    def analyze_target_gap(
        self,
        product_name: str,
        product_model: Dict[str, Any],
        inv_items: Dict[str, float],
        target_units: int,
        bom_code_index: Optional[Dict[str, Dict[str, Any]]] = None,
        part_meta_index: Optional[Dict[str, Dict[str, str]]] = None,
        visited_codes: Optional[Set[str]] = None,
    ) -> Dict[str, Any]:
        """
        Target-gap analysis for one finished product:
        - Given a target units number, show current buildable units and shortage.
        - Expand recursively to show shortage on finished/head/pcba/material rows.
        """
        part_meta_index = part_meta_index or {}
        target_units = max(0, int(target_units or 0))
        visited_codes = set(visited_codes or set())
        current_product_code = self._normalize_part_no(str(product_model.get("product_code", "")).strip())
        if current_product_code:
            visited_codes.add(current_product_code)

        current_eval = self.evaluate_product_capacity(
            product_name,
            product_model,
            inv_items,
            bom_code_index=bom_code_index,
            part_meta_index=part_meta_index,
        )
        current_capacity = int(current_eval.get("capacity", 0))
        gap_units = max(0, target_units - current_capacity)

        trace_rows: List[Dict[str, Any]] = []
        reference_plan = self._build_one_unit_consumption(
            product_model,
            inv_items,
            bom_code_index=bom_code_index,
            trace_rows=trace_rows,
        )
        if reference_plan is None:
            # fallback with virtual sufficient stock to still expose the BOM chain.
            reference_stock: Dict[str, float] = {}
            if bom_code_index:
                for code, model in bom_code_index.items():
                    reference_stock[code] = 10 ** 9
                    for part_no in (model.get("fixed_parts") or {}).keys():
                        reference_stock[str(part_no)] = 10 ** 9
                    for group in (model.get("alternative_groups") or []):
                        for option in (group.get("options") or []):
                            part_no = str(option.get("part_no", "")).strip()
                            if part_no:
                                reference_stock[part_no] = 10 ** 9
            if not reference_stock:
                for part_no in (product_model.get("fixed_parts") or {}).keys():
                    reference_stock[str(part_no)] = 10 ** 9
                for group in (product_model.get("alternative_groups") or []):
                    for option in (group.get("options") or []):
                        part_no = str(option.get("part_no", "")).strip()
                        if part_no:
                            reference_stock[part_no] = 10 ** 9
            trace_rows = []
            reference_plan = self._build_one_unit_consumption(
                product_model,
                reference_stock,
                bom_code_index=bom_code_index,
                trace_rows=trace_rows,
            )

        layer_order = {"finished": 1, "head": 2, "pcba": 3, "other": 9}
        layer_rows_map: Dict[str, Dict[str, Any]] = {}
        child_capacity_cache: Dict[str, int] = {}
        root_product_code = self._normalize_part_no(str(product_model.get("product_code", "")).strip())

        def get_child_capacity(product_code: str) -> int:
            code = str(product_code or "").strip()
            if not code:
                return 0
            if code in child_capacity_cache:
                return child_capacity_cache[code]
            child_model = (bom_code_index or {}).get(code) if bom_code_index else None
            if child_model is None:
                child_capacity_cache[code] = 0
                return 0
            child_name = str(child_model.get("product_name", "") or "").strip()
            child_label = f"{child_name} ({code})" if child_name else code
            child_eval = self.evaluate_product_capacity(
                child_label,
                child_model,
                inv_items,
                bom_code_index=bom_code_index,
                part_meta_index=part_meta_index,
            )
            child_cap = int(child_eval.get("capacity", 0))
            child_capacity_cache[code] = child_cap
            return child_cap

        for row in trace_rows:
            tier = str(row.get("tier", "other") or "other")
            tier_label = str(
                row.get("tier_label", self._resolve_bom_tier_label(tier))
                or self._resolve_bom_tier_label(tier)
            )
            part_no = str(row.get("part_no", "")).strip()
            req_qty = float(row.get("required_qty", 0.0) or 0.0)
            if not part_no or req_qty <= 0:
                continue

            is_subassembly = bool(row.get("is_subassembly"))
            source_product_code = str(row.get("source_product_code", "")).strip()
            source_product_name = str(row.get("source_product_name", "") or "").strip()

            if tier not in layer_rows_map:
                layer_rows_map[tier] = {
                    "tier": tier,
                    "label": tier_label,
                    "rows": {},
                }

            rows_map: Dict[str, Any] = layer_rows_map[tier]["rows"]
            row_key = f"{source_product_code}::{part_no}"
            if row_key not in rows_map:
                meta = dict(part_meta_index.get(part_no, {}) or {})
                if is_subassembly and (not meta.get("name")):
                    child_model = (bom_code_index or {}).get(part_no) if bom_code_index else None
                    if child_model is not None:
                        meta["name"] = str(child_model.get("product_name", "") or "")
                        meta["spec"] = str(child_model.get("product_code", "") or "")
                rows_map[row_key] = {
                    "part_no": part_no,
                    "name": str(meta.get("name", "") or ""),
                    "spec": str(meta.get("spec", "") or ""),
                    "manufacturer": str(meta.get("manufacturer", "") or ""),
                    "required_qty_per_unit": 0.0,
                    "source_product_code": source_product_code,
                    "source_product_name": source_product_name,
                    "is_subassembly": is_subassembly,
                    "alt_group": row.get("alt_group"),
                    "is_alternative": row.get("alt_group") is not None,
                }
            rows_map[row_key]["required_qty_per_unit"] += req_qty
            rows_map[row_key]["is_subassembly"] = bool(rows_map[row_key]["is_subassembly"] or is_subassembly)
            if rows_map[row_key].get("alt_group") is None and row.get("alt_group") is not None:
                rows_map[row_key]["alt_group"] = row.get("alt_group")
                rows_map[row_key]["is_alternative"] = True

        layers: List[Dict[str, Any]] = []
        subassembly_shortages: List[Dict[str, Any]] = []
        material_shortages_detail: List[Dict[str, Any]] = []
        material_required_totals: Dict[str, Dict[str, Any]] = {}
        nested_gap_details: List[Dict[str, Any]] = []

        for layer in sorted(
            layer_rows_map.values(),
            key=lambda item: (layer_order.get(str(item.get("tier", "")), 99), str(item.get("label", ""))),
        ):
            rows_map = layer.get("rows", {}) or {}
            alt_group_rows_to_skip: Set[str] = set()
            alt_group_override_rows: List[Dict[str, Any]] = []

            alt_groups_by_source: Dict[tuple[str, str], List[tuple[str, Dict[str, Any]]]] = {}
            for row_key, row in rows_map.items():
                alt_group = row.get("alt_group")
                if row.get("is_subassembly") or alt_group is None:
                    continue
                source_code = str(row.get("source_product_code", "")).strip()
                group_key = (source_code, str(alt_group))
                alt_groups_by_source.setdefault(group_key, []).append((row_key, row))

            for (source_code, group_id), grouped_rows in alt_groups_by_source.items():
                source_model = None
                if source_code and source_code == root_product_code:
                    source_model = product_model
                elif source_code:
                    source_model = (bom_code_index or {}).get(source_code)
                if source_model is None:
                    continue

                group_def = next(
                    (group for group in (source_model.get("alternative_groups") or []) if str(group.get("group_id")) == group_id),
                    None,
                )
                if not group_def:
                    continue

                selected_row_key, selected_row = grouped_rows[0]
                selected_part_no = str(selected_row.get("part_no", "")).strip()
                selected_option = next(
                    (option for option in (group_def.get("options") or []) if str(option.get("part_no", "")).strip() == selected_part_no),
                    None,
                )
                selected_option_req = self._to_number((selected_option or {}).get("required_qty"), 0.0)
                selected_required_per_root = float(selected_row.get("required_qty_per_unit", 0.0) or 0.0)
                multiplier = (
                    selected_required_per_root / selected_option_req
                    if selected_option_req > 0
                    else 1.0
                )
                if multiplier <= 0:
                    multiplier = 1.0

                option_rows: List[Dict[str, Any]] = []
                group_satisfied = False
                for option in (group_def.get("options") or []):
                    option_part_no = str(option.get("part_no", "")).strip()
                    option_req = self._to_number(option.get("required_qty"), 0.0)
                    if not option_part_no or option_req <= 0:
                        continue
                    required_per_unit = multiplier * option_req
                    required_total_qty = required_per_unit * target_units
                    available_qty = float(inv_items.get(option_part_no, 0.0))
                    shortage_qty = max(0.0, required_total_qty - available_qty)
                    can_support_units = int(available_qty // required_per_unit) if required_per_unit > 0 else 0
                    shortage_units = max(0, target_units - can_support_units)
                    if shortage_qty <= 0:
                        group_satisfied = True
                    option_meta = dict(part_meta_index.get(option_part_no, {}) or {})
                    option_rows.append(
                        {
                            "part_no": option_part_no,
                            "name": str(option_meta.get("name", "") or ""),
                            "spec": str(option_meta.get("spec", "") or ""),
                            "manufacturer": str(option_meta.get("manufacturer", "") or ""),
                            "source_product_code": source_code,
                            "source_product_name": str(selected_row.get("source_product_name", "") or ""),
                            "is_subassembly": False,
                            "required_qty_per_unit": self._compact_number(required_per_unit),
                            "required_total_qty": self._compact_number(required_total_qty),
                            "available_qty": self._compact_number(available_qty),
                            "shortage_qty": self._compact_number(shortage_qty),
                            "can_support_units": can_support_units,
                            "shortage_units": shortage_units,
                            "alt_group": group_id,
                            "is_alternative": True,
                        }
                    )

                if group_satisfied:
                    alt_group_rows_to_skip.update(row_key for row_key, _ in grouped_rows)
                    continue

                alt_group_rows_to_skip.update(row_key for row_key, _ in grouped_rows)
                alt_group_override_rows.extend(option_rows)

            layer_rows: List[Dict[str, Any]] = []
            for row_key, row in rows_map.items():
                if row_key in alt_group_rows_to_skip:
                    continue
                required_per_unit = float(row.get("required_qty_per_unit", 0.0) or 0.0)
                if required_per_unit <= 0:
                    continue
                available_qty = float(inv_items.get(str(row.get("part_no", "")).strip(), 0.0))
                required_total_qty = required_per_unit * target_units
                shortage_qty = max(0.0, required_total_qty - available_qty)
                can_support_units = int(available_qty // required_per_unit) if required_per_unit > 0 else 0
                shortage_units = max(0, target_units - can_support_units)

                row_data = {
                    "part_no": str(row.get("part_no", "")).strip(),
                    "name": str(row.get("name", "") or ""),
                    "spec": str(row.get("spec", "") or ""),
                    "manufacturer": str(row.get("manufacturer", "") or ""),
                    "source_product_code": str(row.get("source_product_code", "")).strip(),
                    "source_product_name": str(row.get("source_product_name", "") or ""),
                    "is_subassembly": bool(row.get("is_subassembly")),
                    "required_qty_per_unit": self._compact_number(required_per_unit),
                    "required_total_qty": self._compact_number(required_total_qty),
                    "available_qty": self._compact_number(available_qty),
                    "shortage_qty": self._compact_number(shortage_qty),
                    "can_support_units": can_support_units,
                    "shortage_units": shortage_units,
                    "alt_group": row.get("alt_group"),
                    "is_alternative": bool(row.get("is_alternative")),
                }

                if row_data["is_subassembly"]:
                    sub_cap = get_child_capacity(row_data["part_no"])
                    sub_need_units = int(round(required_total_qty))
                    sub_gap_units = max(0, sub_need_units - sub_cap)
                    row_data["subassembly_buildable_units"] = sub_cap
                    row_data["subassembly_required_units"] = sub_need_units
                    row_data["subassembly_gap_units"] = sub_gap_units
                    if sub_gap_units > 0:
                        subassembly_shortages.append(
                            {
                                "tier": str(layer.get("tier", "other")),
                                "tier_label": str(layer.get("label", "其他层级BOM")),
                                "part_no": row_data["part_no"],
                                "name": row_data["name"],
                                "required_units": sub_need_units,
                                "buildable_units": sub_cap,
                                "gap_units": sub_gap_units,
                            }
                        )
                        child_code = str(row_data["part_no"]).strip()
                        child_model = (bom_code_index or {}).get(child_code) if bom_code_index else None
                        if child_model is not None and child_code and child_code not in visited_codes:
                            child_name = str(row_data.get("name", "") or "").strip()
                            child_label = f"{child_name} ({child_code})" if child_name and child_code not in child_name else (child_name or child_code)
                            child_gap_detail = self.analyze_target_gap(
                                product_name=child_label,
                                product_model=child_model,
                                inv_items=inv_items,
                                target_units=sub_gap_units,
                                bom_code_index=bom_code_index,
                                part_meta_index=part_meta_index,
                                visited_codes=visited_codes | {child_code},
                            )
                            nested_gap_details.append(child_gap_detail)
                else:
                    part_no = row_data["part_no"]
                    bucket = material_required_totals.setdefault(
                        part_no,
                        {
                            "part_no": part_no,
                            "name": row_data["name"],
                            "spec": row_data["spec"],
                            "manufacturer": row_data["manufacturer"],
                            "required_total_qty_raw": 0.0,
                            "is_alternative": bool(row_data.get("is_alternative")),
                            "alt_group": row_data.get("alt_group"),
                        },
                    )
                    bucket["required_total_qty_raw"] += required_total_qty
                    if not bucket.get("name") and row_data["name"]:
                        bucket["name"] = row_data["name"]
                    if not bucket.get("spec") and row_data["spec"]:
                        bucket["spec"] = row_data["spec"]
                    if not bucket.get("manufacturer") and row_data["manufacturer"]:
                        bucket["manufacturer"] = row_data["manufacturer"]
                    if row_data.get("is_alternative"):
                        bucket["is_alternative"] = True
                        if bucket.get("alt_group") is None:
                            bucket["alt_group"] = row_data.get("alt_group")

                    if shortage_qty > 0:
                        material_shortages_detail.append(
                            {
                                "tier": str(layer.get("tier", "other")),
                                "tier_label": str(layer.get("label", "其他层级BOM")),
                                "part_no": row_data["part_no"],
                                "name": row_data["name"],
                                "spec": row_data["spec"],
                                "manufacturer": row_data["manufacturer"],
                                "required_total_qty": self._compact_number(required_total_qty),
                                "available_qty": self._compact_number(available_qty),
                                "shortage_qty": self._compact_number(shortage_qty),
                                "shortage_units": shortage_units,
                                "alt_group": row_data.get("alt_group"),
                                "is_alternative": bool(row_data.get("is_alternative")),
                            }
                        )

                layer_rows.append(row_data)

            for row_data in alt_group_override_rows:
                part_no = row_data["part_no"]
                required_total_qty = float(row_data.get("required_total_qty", 0.0) or 0.0)
                shortage_qty = float(row_data.get("shortage_qty", 0.0) or 0.0)
                shortage_units = int(row_data.get("shortage_units", 0) or 0)

                bucket = material_required_totals.setdefault(
                    part_no,
                    {
                        "part_no": part_no,
                        "name": row_data["name"],
                        "spec": row_data["spec"],
                        "manufacturer": row_data["manufacturer"],
                        "required_total_qty_raw": 0.0,
                        "is_alternative": bool(row_data.get("is_alternative")),
                        "alt_group": row_data.get("alt_group"),
                    },
                )
                bucket["required_total_qty_raw"] += required_total_qty
                if not bucket.get("name") and row_data["name"]:
                    bucket["name"] = row_data["name"]
                if not bucket.get("spec") and row_data["spec"]:
                    bucket["spec"] = row_data["spec"]
                if not bucket.get("manufacturer") and row_data["manufacturer"]:
                    bucket["manufacturer"] = row_data["manufacturer"]
                if row_data.get("is_alternative"):
                    bucket["is_alternative"] = True
                    if bucket.get("alt_group") is None:
                        bucket["alt_group"] = row_data.get("alt_group")

                if shortage_qty > 0:
                    material_shortages_detail.append(
                        {
                            "tier": str(layer.get("tier", "other")),
                            "tier_label": str(layer.get("label", "其他层级BOM")),
                            "part_no": row_data["part_no"],
                            "name": row_data["name"],
                            "spec": row_data["spec"],
                            "manufacturer": row_data["manufacturer"],
                            "required_total_qty": self._compact_number(required_total_qty),
                            "available_qty": row_data["available_qty"],
                            "shortage_qty": row_data["shortage_qty"],
                            "shortage_units": shortage_units,
                            "alt_group": row_data.get("alt_group"),
                            "is_alternative": True,
                        }
                    )

                layer_rows.append(row_data)

            layer_rows.sort(
                key=lambda item: (
                    0 if bool(item.get("is_subassembly")) else 1,
                    -float(item.get("shortage_qty", 0) or 0),
                    str(item.get("part_no", "")),
                )
            )
            layers.append(
                {
                    "tier": str(layer.get("tier", "other")),
                    "label": str(layer.get("label", "其他层级BOM")),
                    "rows": layer_rows,
                    "shortage_row_count": len([row for row in layer_rows if float(row.get("shortage_qty", 0) or 0) > 0]),
                }
            )

        subassembly_shortages.sort(key=lambda row: (-int(row.get("gap_units", 0)), str(row.get("part_no", ""))))
        material_shortages_detail.sort(
            key=lambda row: (
                -float(row.get("shortage_qty", 0) or 0),
                -int(row.get("shortage_units", 0) or 0),
                str(row.get("part_no", "")),
            )
        )

        material_shortages: List[Dict[str, Any]] = []
        for part_no, bucket in material_required_totals.items():
            required_total_qty = float(bucket.get("required_total_qty_raw", 0.0) or 0.0)
            if required_total_qty <= 0:
                continue
            available_qty = float(inv_items.get(str(part_no).strip(), 0.0))
            shortage_qty = max(0.0, required_total_qty - available_qty)
            if shortage_qty <= 0:
                continue
            # Convert quantity shortage into impacted units estimate using per-target average.
            shortage_units = int(math.ceil(shortage_qty / max(required_total_qty / max(target_units, 1), 1e-9)))
            material_shortages.append(
                {
                    "part_no": str(part_no),
                    "name": str(bucket.get("name", "") or ""),
                    "spec": str(bucket.get("spec", "") or ""),
                    "manufacturer": str(bucket.get("manufacturer", "") or ""),
                    "required_total_qty": self._compact_number(required_total_qty),
                    "available_qty": self._compact_number(available_qty),
                    "shortage_qty": self._compact_number(shortage_qty),
                    "shortage_units": shortage_units,
                    "alt_group": bucket.get("alt_group"),
                    "is_alternative": bool(bucket.get("is_alternative")),
                }
            )
        material_shortages.sort(
            key=lambda row: (
                -float(row.get("shortage_qty", 0) or 0),
                -int(row.get("shortage_units", 0) or 0),
                str(row.get("part_no", "")),
            )
        )

        if nested_gap_details:
            layer_bucket_map: Dict[tuple[str, str], Dict[str, Any]] = {
                (str(layer.get("tier", "other")), str(layer.get("label", "其他层级BOM"))): layer
                for layer in layers
            }
            material_shortage_map: Dict[str, Dict[str, Any]] = {
                str(item.get("part_no", "")).strip(): dict(item)
                for item in material_shortages
                if str(item.get("part_no", "")).strip()
            }

            for child_gap_detail in nested_gap_details:
                for child_layer in (child_gap_detail.get("layers") or []):
                    layer_key = (
                        str(child_layer.get("tier", "other")),
                        str(child_layer.get("label", "其他层级BOM")),
                    )
                    if layer_key not in layer_bucket_map:
                        new_layer = {
                            "tier": layer_key[0],
                            "label": layer_key[1],
                            "rows": [],
                            "shortage_row_count": 0,
                        }
                        layers.append(new_layer)
                        layer_bucket_map[layer_key] = new_layer

                    target_layer = layer_bucket_map[layer_key]
                    existing_rows: Dict[str, Dict[str, Any]] = {
                        f"{str(row.get('source_product_code', '')).strip()}::{str(row.get('part_no', '')).strip()}": row
                        for row in (target_layer.get("rows") or [])
                    }
                    for row in (child_layer.get("rows") or []):
                        row_key = f"{str(row.get('source_product_code', '')).strip()}::{str(row.get('part_no', '')).strip()}"
                        if row_key not in existing_rows:
                            target_layer.setdefault("rows", []).append(dict(row))
                            existing_rows[row_key] = target_layer["rows"][-1]
                        else:
                            existing = existing_rows[row_key]
                            existing["shortage_qty"] = self._compact_number(
                                max(float(existing.get("shortage_qty", 0) or 0), float(row.get("shortage_qty", 0) or 0))
                            )
                            existing["shortage_units"] = max(
                                int(existing.get("shortage_units", 0) or 0),
                                int(row.get("shortage_units", 0) or 0),
                            )
                            existing["subassembly_gap_units"] = max(
                                int(existing.get("subassembly_gap_units", 0) or 0),
                                int(row.get("subassembly_gap_units", 0) or 0),
                            )
                            if existing.get("subassembly_buildable_units") is None:
                                existing["subassembly_buildable_units"] = row.get("subassembly_buildable_units")

                    target_layer["rows"].sort(
                        key=lambda item: (
                            0 if bool(item.get("is_subassembly")) else 1,
                            -float(item.get("shortage_qty", 0) or 0),
                            str(item.get("part_no", "")),
                        )
                    )
                    target_layer["shortage_row_count"] = len(
                        [row for row in (target_layer.get("rows") or []) if float(row.get("shortage_qty", 0) or 0) > 0]
                    )

                subassembly_shortages.extend(child_gap_detail.get("subassembly_shortages", []) or [])
                material_shortages_detail.extend(child_gap_detail.get("material_shortages_detail", []) or [])

                for item in (child_gap_detail.get("material_shortages") or []):
                    part_no = str(item.get("part_no", "")).strip()
                    if not part_no:
                        continue
                    existing = material_shortage_map.get(part_no)
                    if existing is None:
                        material_shortage_map[part_no] = dict(item)
                        continue
                    existing["shortage_qty"] = self._compact_number(
                        max(float(existing.get("shortage_qty", 0) or 0), float(item.get("shortage_qty", 0) or 0))
                    )
                    existing["shortage_units"] = max(
                        int(existing.get("shortage_units", 0) or 0),
                        int(item.get("shortage_units", 0) or 0),
                    )
                    if not existing.get("name") and item.get("name"):
                        existing["name"] = item.get("name")
                    if not existing.get("spec") and item.get("spec"):
                        existing["spec"] = item.get("spec")
                    if not existing.get("manufacturer") and item.get("manufacturer"):
                        existing["manufacturer"] = item.get("manufacturer")

            subassembly_shortages.sort(key=lambda row: (-int(row.get("gap_units", 0)), str(row.get("part_no", ""))))
            material_shortages_detail.sort(
                key=lambda row: (
                    -float(row.get("shortage_qty", 0) or 0),
                    -int(row.get("shortage_units", 0) or 0),
                    str(row.get("part_no", "")),
                )
            )
            layers.sort(
                key=lambda item: (layer_order.get(str(item.get("tier", "")), 99), str(item.get("label", "")))
            )
            material_shortages = sorted(
                material_shortage_map.values(),
                key=lambda row: (
                    -float(row.get("shortage_qty", 0) or 0),
                    -int(row.get("shortage_units", 0) or 0),
                    str(row.get("part_no", "")),
                )
            )

        return {
            "product": product_name,
            "line": str(product_model.get("line", "未分类")),
            "source_file": str(product_model.get("source_file", "")),
            "target_units": target_units,
            "current_capacity": current_capacity,
            "gap_units": gap_units,
            "target_met": gap_units == 0,
            "layers": layers,
            "subassembly_shortages": subassembly_shortages,
            "material_shortages": material_shortages,
            "material_shortages_detail": material_shortages_detail,
            "reference_plan_found": reference_plan is not None,
        }

    def analyze_target_gap_batch(
        self,
        targets: List[Dict[str, Any]],
        inv_items: Dict[str, float],
        bom_code_index: Optional[Dict[str, Dict[str, Any]]] = None,
        part_meta_index: Optional[Dict[str, Dict[str, str]]] = None,
    ) -> Dict[str, Any]:
        """
        Batch target-gap analysis under ONE shared stock pool.
        Strategy:
        - Round-robin build: each target attempts one unit per round.
        - All products consume from the same inventory snapshot.
        - For unmet gap of each target, run gap analysis on remaining stock.
        - UI-facing "available_qty" always reports current stock snapshot, not simulated remaining stock.
        """
        part_meta_index = part_meta_index or {}
        states: List[Dict[str, Any]] = []
        for idx, item in enumerate(targets):
            product_name = str(item.get("product_name", "")).strip()
            product_model = item.get("product_model") or {}
            target_units = max(0, int(item.get("target_units", 0) or 0))
            if not product_name or not isinstance(product_model, dict) or target_units <= 0:
                continue
            states.append(
                {
                    "row_id": str(item.get("row_id", "") or f"row-{idx + 1}"),
                    "line": str(item.get("line", product_model.get("line", "未分类"))),
                    "product_name": product_name,
                    "product_model": product_model,
                    "target_units": target_units,
                    "produced_units": 0,
                }
            )

        if not states:
            return {
                "summary": {
                    "target_count": 0,
                    "target_units_total": 0,
                    "producible_units_total": 0,
                    "gap_units_total": 0,
                    "rounds": 0,
                },
                "rows": [],
                "material_shortages": [],
            }

        current_stock: Dict[str, float] = {str(k): float(v) for k, v in (inv_items or {}).items()}
        sim_stock: Dict[str, float] = dict(current_stock)
        rounds = 0
        remaining_target_units = sum(int(state["target_units"]) for state in states)
        max_rounds = max(1000, remaining_target_units * 2 + 100)

        while remaining_target_units > 0 and rounds < max_rounds:
            rounds += 1
            progressed = False
            for state in states:
                if state["produced_units"] >= state["target_units"]:
                    continue
                unit_plan = self._build_one_unit_consumption(
                    state["product_model"],
                    sim_stock,
                    bom_code_index=bom_code_index,
                )
                if unit_plan is None:
                    continue
                for part_no, req_qty in (unit_plan.get("consumption") or {}).items():
                    sim_stock[part_no] = float(sim_stock.get(part_no, 0.0)) - float(req_qty)
                state["produced_units"] += 1
                remaining_target_units -= 1
                progressed = True
            if not progressed:
                break

        row_results: List[Dict[str, Any]] = []
        aggregated_shortages: Dict[str, Dict[str, Any]] = {}

        def inject_current_stock_available_qty(gap_detail: Dict[str, Any]) -> Dict[str, Any]:
            def enrich_item(item: Dict[str, Any]) -> None:
                part_no = str(item.get("part_no", "")).strip()
                if not part_no:
                    return
                simulated_available_qty = float(item.get("available_qty", 0.0) or 0.0)
                current_available_qty = float(current_stock.get(part_no, 0.0))
                reserved_qty = max(0.0, current_available_qty - simulated_available_qty)
                item["simulated_available_qty"] = self._compact_number(simulated_available_qty)
                item["current_available_qty"] = self._compact_number(current_available_qty)
                item["reserved_qty"] = self._compact_number(reserved_qty)
                item["available_qty"] = self._compact_number(current_available_qty)

            layers = gap_detail.get("layers", []) or []
            for layer in layers:
                for item in (layer.get("rows") or []):
                    enrich_item(item)

            for key in ("material_shortages", "material_shortages_detail"):
                for item in (gap_detail.get(key, []) or []):
                    enrich_item(item)

            return gap_detail

        for state in states:
            target_units = int(state["target_units"])
            produced_units = int(state["produced_units"])
            gap_units = max(0, target_units - produced_units)

            row_data: Dict[str, Any] = {
                "row_id": state["row_id"],
                "line": state["line"],
                "product": state["product_name"],
                "source_file": str(state["product_model"].get("source_file", "")),
                "target_units": target_units,
                "current_capacity": produced_units,
                "gap_units": gap_units,
                "target_met": gap_units == 0,
                "layers": [],
                "subassembly_shortages": [],
                "material_shortages": [],
                "material_shortages_detail": [],
            }

            if gap_units > 0:
                gap_detail = self.analyze_target_gap(
                    product_name=state["product_name"],
                    product_model=state["product_model"],
                    inv_items=sim_stock,
                    target_units=gap_units,
                    bom_code_index=bom_code_index,
                    part_meta_index=part_meta_index,
                )
                gap_detail = inject_current_stock_available_qty(gap_detail)
                row_data["layers"] = gap_detail.get("layers", []) or []
                row_data["subassembly_shortages"] = gap_detail.get("subassembly_shortages", []) or []
                row_data["material_shortages"] = gap_detail.get("material_shortages", []) or []
                row_data["material_shortages_detail"] = gap_detail.get("material_shortages_detail", []) or []

                for shortage in row_data["material_shortages"]:
                    part_no = str(shortage.get("part_no", "")).strip()
                    if not part_no:
                        continue
                    qty = float(shortage.get("shortage_qty", 0.0) or 0.0)
                    if qty <= 0:
                        continue
                    bucket = aggregated_shortages.setdefault(
                        part_no,
                        {
                            "part_no": part_no,
                            "name": str(shortage.get("name", "") or ""),
                            "spec": str(shortage.get("spec", "") or ""),
                            "manufacturer": str(shortage.get("manufacturer", "") or ""),
                            "available_qty": self._compact_number(float(current_stock.get(part_no, 0.0))),
                            "shortage_qty_raw": 0.0,
                        },
                    )
                    bucket["shortage_qty_raw"] += qty
                    if not bucket.get("name") and shortage.get("name"):
                        bucket["name"] = str(shortage.get("name", "") or "")
                    if not bucket.get("spec") and shortage.get("spec"):
                        bucket["spec"] = str(shortage.get("spec", "") or "")
                    if not bucket.get("manufacturer") and shortage.get("manufacturer"):
                        bucket["manufacturer"] = str(shortage.get("manufacturer", "") or "")

            row_results.append(row_data)

        material_shortages = []
        for _, bucket in aggregated_shortages.items():
            material_shortages.append(
                {
                    "part_no": bucket["part_no"],
                    "name": bucket.get("name", ""),
                    "spec": bucket.get("spec", ""),
                    "manufacturer": bucket.get("manufacturer", ""),
                    "available_qty": bucket.get("available_qty", 0),
                    "shortage_qty": self._compact_number(float(bucket.get("shortage_qty_raw", 0.0) or 0.0)),
                }
            )
        material_shortages.sort(
            key=lambda row: (
                -float(row.get("shortage_qty", 0) or 0),
                str(row.get("part_no", "")),
            )
        )

        target_units_total = sum(int(row.get("target_units", 0) or 0) for row in row_results)
        producible_units_total = sum(int(row.get("current_capacity", 0) or 0) for row in row_results)
        gap_units_total = sum(int(row.get("gap_units", 0) or 0) for row in row_results)

        return {
            "summary": {
                "target_count": len(row_results),
                "target_units_total": target_units_total,
                "producible_units_total": producible_units_total,
                "gap_units_total": gap_units_total,
                "rounds": rounds,
            },
            "rows": row_results,
            "material_shortages": material_shortages,
            "remaining_inventory_part_count": len([qty for qty in sim_stock.values() if float(qty) > 0]),
        }

    def _build_one_unit_consumption(
        self,
        product_model: Dict[str, Any],
        stock: Dict[str, float],
        bom_code_index: Optional[Dict[str, Dict[str, Any]]] = None,
        inherited_consumption: Optional[Dict[str, float]] = None,
        call_stack: Optional[Set[str]] = None,
        trace_rows: Optional[List[Dict[str, Any]]] = None,
    ) -> Optional[Dict[str, Any]]:
        """
        Build one-unit consumption plan for a product under current stock.
        Alternative groups are solved as single-choice per unit (cannot mix).
        Supports recursive expansion when BOM fixed parts include sub-assembly product codes.
        """
        consumption: Dict[str, float] = {}
        selected_options = []
        inherited_consumption = inherited_consumption or {}
        call_stack = set(call_stack or set())
        trace_rows = trace_rows if trace_rows is not None else []
        product_code = self._normalize_part_no(str(product_model.get("product_code", "")).strip())
        product_name = str(product_model.get("product_name", "") or "").strip()
        bom_tier = self._resolve_bom_tier(product_code)
        stack_token = product_code or str(id(product_model))
        if stack_token in call_stack:
            return None
        call_stack.add(stack_token)

        def get_available(part_no: str) -> float:
            return (
                float(stock.get(part_no, 0.0))
                - float(inherited_consumption.get(part_no, 0.0))
                - float(consumption.get(part_no, 0.0))
            )

        def add_consumption(part_no: str, req_qty: float) -> bool:
            if req_qty <= 0:
                return True
            if get_available(part_no) < req_qty:
                return False
            consumption[part_no] = consumption.get(part_no, 0.0) + req_qty
            return True

        # Fixed parts are mandatory.
        for part_no, req_qty in product_model.get("fixed_parts", {}).items():
            if req_qty <= 0:
                continue

            # Recursive expansion: a fixed part may itself be another BOM product code.
            child_model = (bom_code_index or {}).get(part_no) if bom_code_index else None
            if child_model is not None and part_no != product_code:
                remaining_qty = float(req_qty)
                direct_stock_qty = 0.0
                available_subassembly_qty = max(0.0, get_available(part_no))
                if available_subassembly_qty > EPSILON:
                    direct_stock_qty = min(remaining_qty, available_subassembly_qty)
                    if direct_stock_qty > EPSILON:
                        if not add_consumption(part_no, direct_stock_qty):
                            return None
                        remaining_qty -= direct_stock_qty
                trace_rows.append(
                    {
                        "tier": bom_tier,
                        "tier_label": self._resolve_bom_tier_label(bom_tier),
                        "source_product_code": product_code,
                        "source_product_name": product_name,
                        "part_no": part_no,
                        "required_qty": req_qty,
                        "is_subassembly": True,
                        "direct_stock_qty": self._compact_number(direct_stock_qty),
                        "recursive_qty": self._compact_number(max(0.0, remaining_qty)),
                    }
                )
                if remaining_qty <= EPSILON:
                    continue

                nearest_int = int(round(remaining_qty))
                if remaining_qty > 0 and abs(remaining_qty - nearest_int) < 1e-9 and nearest_int <= 20:
                    for _ in range(max(1, nearest_int)):
                        merged_inherited = dict(inherited_consumption)
                        for used_part, used_qty in consumption.items():
                            merged_inherited[used_part] = merged_inherited.get(used_part, 0.0) + used_qty
                        child_plan = self._build_one_unit_consumption(
                            child_model,
                            stock,
                            bom_code_index=bom_code_index,
                            inherited_consumption=merged_inherited,
                            call_stack=call_stack,
                            trace_rows=trace_rows,
                        )
                        if child_plan is None:
                            return None
                        for used_part, used_qty in (child_plan.get("consumption") or {}).items():
                            if not add_consumption(used_part, float(used_qty)):
                                return None
                else:
                    merged_inherited = dict(inherited_consumption)
                    for used_part, used_qty in consumption.items():
                        merged_inherited[used_part] = merged_inherited.get(used_part, 0.0) + used_qty
                    child_plan = self._build_one_unit_consumption(
                        child_model,
                        stock,
                        bom_code_index=bom_code_index,
                        inherited_consumption=merged_inherited,
                        call_stack=call_stack,
                        trace_rows=trace_rows,
                    )
                    if child_plan is None:
                        return None
                    for used_part, used_qty in (child_plan.get("consumption") or {}).items():
                        if not add_consumption(used_part, float(used_qty) * remaining_qty):
                            return None
                continue

            if not add_consumption(part_no, req_qty):
                return None
            trace_rows.append(
                {
                    "tier": bom_tier,
                    "tier_label": self._resolve_bom_tier_label(bom_tier),
                    "source_product_code": product_code,
                    "source_product_name": product_name,
                    "part_no": part_no,
                    "required_qty": req_qty,
                    "is_subassembly": False,
                }
            )

        # For each alternative group choose one feasible option.
        for group in product_model.get("alternative_groups", []):
            group_id = str(group.get("group_id"))
            best_option = None

            for option in group.get("options", []):
                part_no = str(option.get("part_no", "")).strip()
                req_qty = self._to_number(option.get("required_qty"), 0.0)
                if not part_no or req_qty <= 0:
                    continue

                available = get_available(part_no)
                if available < req_qty:
                    continue

                pressure = req_qty / max(available, 1e-9)
                if best_option is None or pressure < best_option["pressure"]:
                    best_option = {
                        "part_no": part_no,
                        "required_qty": req_qty,
                        "pressure": pressure,
                    }

            if best_option is None:
                return None

            part_no = best_option["part_no"]
            req_qty = best_option["required_qty"]
            if not add_consumption(part_no, req_qty):
                return None
            trace_rows.append(
                {
                    "tier": bom_tier,
                    "tier_label": self._resolve_bom_tier_label(bom_tier),
                    "source_product_code": product_code,
                    "source_product_name": product_name,
                    "part_no": part_no,
                    "required_qty": req_qty,
                    "is_subassembly": False,
                    "alt_group": group_id,
                }
            )
            selected_options.append(
                {
                    "alt_group": group_id,
                    "part_no": part_no,
                    "required_qty": req_qty,
                }
            )

        unit_pressure = 0.0
        for part_no, req_qty in consumption.items():
            available = float(stock.get(part_no, 0.0))
            unit_pressure += req_qty / max(available, 1e-9)

        return {
            "consumption": consumption,
            "selected_options": selected_options,
            "unit_pressure": unit_pressure,
        }

    @staticmethod
    def _to_number(value: Any, default: float = 0.0) -> float:
        return to_number(value, default)

    @staticmethod
    def _compact_number(value: float) -> Any:
        return compact_number(value)

    @staticmethod
    def _normalize_part_no(raw_part_no: str) -> str:
        return normalize_part_no(raw_part_no)

    def parse_excel_attachment(self, file_content: bytes, filename: str) -> Dict[str, Any]:
        parsed_data = parse_inventory_excel_attachment(file_content, filename)
        if "error" in parsed_data:
            return parsed_data
        return self.sanitize_inventory_dataset(parsed_data)

    def calculate_production_capacity(self, inventory_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Calculates production capacity by checking current inventory against ALL parsed BOMs.
        Returns the most viable product capacity.
        """
        if "error" in inventory_data:
            return {"capacity": 0, "bottleneck": f"Error: {inventory_data['error']}", "notes": ""}
            
        inv_items = inventory_data.get("items", {})
        if not inv_items:
            return {"capacity": 0, "bottleneck": "Empty Inventory", "notes": ""}
            
        bom_models_all = self._extract_bom_models()
        if not bom_models_all:
            # Fallback to sum of inventory as a mock 
            return {"capacity": 0, "bottleneck": "No valid BOMs found in database", "notes": ""}
        bom_models = self._get_finished_models(bom_models_all)
        bom_code_index = self._build_product_code_index(bom_models_all)
        part_meta_index = self._build_part_meta_index(bom_models_all)
            
        best_capacity = 0
        best_product = ""
        overall_bottleneck = ""
        bom_reports = []
        
        for product, model in bom_models.items():
            result = self.evaluate_product_capacity(
                product,
                model,
                inv_items,
                bom_code_index=bom_code_index,
                part_meta_index=part_meta_index,
            )
            capacity = int(result.get("capacity", 0))
            bottleneck = str(result.get("bottleneck", ""))

            bom_reports.append(f"{product}: {capacity}台 (瓶颈物料: {bottleneck})")

            if capacity > best_capacity:
                best_capacity = capacity
                best_product = product
                overall_bottleneck = bottleneck
                
        # Format a nice summary notes
        notes_str = "\n".join(bom_reports)
        
        return {
            "capacity": best_capacity,
            "bottleneck": overall_bottleneck if overall_bottleneck else "全体缺料",
            "notes": notes_str
        }
