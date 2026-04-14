import type React from 'react';

export type TargetGapMode = 'finished' | 'subassembly';

export interface TargetGapSelectableProduct {
  product_code: string;
  product_name: string;
  line?: string;
  source_file?: string;
  tier: 'finished' | 'head' | 'pcba' | 'other';
}

export interface TargetGapInputRow {
  id: string;
  line: string;
  productKey: string;
  targetUnits: string;
}

export interface TargetGapShortage {
  part_no: string;
  name?: string;
  spec?: string;
  manufacturer?: string;
  available_qty?: number;
  current_available_qty?: number;
  simulated_available_qty?: number;
  reserved_qty?: number;
  shortage_qty: number;
  alt_group?: string | number | null;
  is_alternative?: boolean;
}

export interface GlobalShortageCandidate {
  part_no: string;
  name?: string;
  spec?: string;
  available_qty?: number;
  current_available_qty?: number;
  simulated_available_qty?: number;
  reserved_qty?: number;
  produced_units?: number;
  shortage_qty: number;
}

export interface GlobalShortageEntry {
  key: string;
  type: 'material' | 'alternative_group';
  label: string;
  part_no?: string;
  name?: string;
  spec?: string;
  available_qty?: number;
  current_available_qty?: number;
  simulated_available_qty?: number;
  reserved_qty?: number;
  shortage_qty: number;
  source_product_name?: string;
  produced_units?: number;
  option_count?: number;
  candidates?: GlobalShortageCandidate[];
}

export interface TargetGapLayerRow {
  part_no: string;
  name?: string;
  spec?: string;
  manufacturer?: string;
  source_product_code?: string;
  source_product_name?: string;
  is_subassembly: boolean;
  available_qty?: number;
  current_available_qty?: number;
  simulated_available_qty?: number;
  reserved_qty?: number;
  shortage_qty: number;
  shortage_units: number;
  alt_group?: string | number | null;
  is_alternative?: boolean;
  subassembly_buildable_units?: number;
  subassembly_gap_units?: number;
}

export interface TargetGapLayer {
  tier: string;
  label: string;
  rows: TargetGapLayerRow[];
}

export interface TargetGapBatchRowResult {
  row_id: string;
  line: string;
  product: string;
  source_file?: string;
  target_units: number;
  current_capacity: number;
  gap_units: number;
  target_met: boolean;
  layers?: TargetGapLayer[];
  subassembly_shortages?: {
    part_no: string;
    gap_units: number;
    buildable_units?: number;
  }[];
  material_shortages: TargetGapShortage[];
}

export interface TargetGapBatchResult {
  summary: {
    target_count: number;
    target_units_total: number;
    producible_units_total: number;
    gap_units_total: number;
    rounds: number;
  };
  rows: TargetGapBatchRowResult[];
  material_shortages: TargetGapShortage[];
}

export interface TargetGapBatchResponse {
  target_gap_batch: TargetGapBatchResult;
}

export interface TargetGapTreeNode {
  key: string;
  type: 'assembly' | 'material' | 'alternative_group';
  code: string;
  label: string;
  tier_label?: string;
  shortage_qty?: number;
  impact_units?: number;
  available_qty?: number;
  current_available_qty?: number;
  simulated_available_qty?: number;
  reserved_qty?: number;
  buildable_units?: number;
  inferred_from_children?: boolean;
  spec?: string;
  manufacturer?: string;
  alt_group?: string | number | null;
  is_alternative?: boolean;
  option_count?: number;
  children: TargetGapTreeNode[];
}

export interface TargetGapPanelProps {
  targetGapMode: TargetGapMode;
  onChangeTargetGapMode: (mode: TargetGapMode) => void;
  targetGapLines: string[];
  targetGapProductsByLine: Record<string, TargetGapSelectableProduct[]>;
  displayLineName: (line?: string) => string;
  getTargetGapProductStableKey: (product: TargetGapSelectableProduct) => string;
  targetGapRows: TargetGapInputRow[];
  setTargetGapRows: React.Dispatch<React.SetStateAction<TargetGapInputRow[]>>;
  targetGapLoading: boolean;
  onAnalyzeTargetGapBatch: () => void;
  targetGapBatchResult: TargetGapBatchResult | null;
}
