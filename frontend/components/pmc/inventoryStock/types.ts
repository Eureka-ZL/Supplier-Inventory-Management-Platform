import type { InventoryAdjustmentCycleSummary, InventoryAdjustmentEvent } from '../../../services/api';

export interface InventoryItem {
  part_no: string;
  quantity: number;
  raw_part_no?: string;
  description?: string;
  good_qty?: number;
  bad_qty?: number;
  total_qty?: number;
  sheet_name?: string;
  category?: string;
  warehouse?: string;
  quality_class?: string;
  status?: string;
  item_type?: 'raw_material' | 'semifinished' | 'finished_goods';
  merged_row_count?: number;
}

export interface InventoryData {
  items: InventoryItem[];
  total_items: number;
}

export interface InventoryStockPanelProps {
  inventory: InventoryData;
  adjustmentEvents?: InventoryAdjustmentEvent[];
  adjustmentSummary?: InventoryAdjustmentCycleSummary | null;
}

export interface InventoryPivotRow {
  partNo: string;
  description: string;
  category?: string;
  frequency: number;
  netChange: number;
  currentTotal: number;
  originalTotal: number;
  outboundCount: number;
  inboundCount: number;
  scrapCount: number;
  topActor: string;
}

export interface InventoryTraceStep {
  id: number;
  beforeQuantity: number;
  afterQuantity: number;
  delta: number;
  actor: string;
  originalEmailBody: string;
  applyNote: string;
  changeLabel: string;
  timestamp: string;
  sender: string;
}

export interface InventoryTraceData {
  currentQuantity: number;
  baseQuantity: number;
  emailNetChange: number;
  projectedQuantity: number;
  variance: number;
  steps: InventoryTraceStep[];
  baseTimestamp: string;
  latestTimestamp: string;
}
