export interface InventoryRecord {
  id: number;
  source_email: string;
  file_name: string;
  parsed_at: string;
  calculated_capacity: number;
}

export interface ManualSyncResult {
  success: boolean;
  status: 'imported' | 'imported_fallback' | 'duplicate' | 'invalid' | 'no_candidate' | 'no_message' | 'unauthorized' | string;
  message: string;
  record_id?: number;
  email?: {
    message_id?: string;
    sender?: string;
    subject?: string;
    received_at?: string | null;
  };
  attachment?: {
    file_name?: string;
    file_size_bytes?: number;
  };
  inventory?: {
    part_count?: number;
    row_count?: number;
  };
  capacity?: {
    best_capacity?: number;
    bottleneck?: string;
  };
  parse_error?: string;
  skipped_latest?: {
    message?: string;
    parse_error?: string;
    email?: {
      subject?: string;
      sender?: string;
      received_at?: string | null;
    };
    attachment?: {
      file_name?: string;
    };
  };
}

export interface UploadResult {
  record_id: number;
  inventory: {
    items: {
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
    }[];
    total_items: number;
  };
  capacity_analysis: {
    products: {
      product: string;
      line?: string;
      source_file?: string;
      capacity: number;
      bottleneck: string;
      parts: {
        part_no: string;
        name?: string;
        spec?: string;
        manufacturer?: string;
        required_qty: number;
        available_qty: number;
        can_produce: number;
        is_bottleneck: boolean;
        part_type?: 'fixed' | 'alternative';
        alt_group?: string;
        is_selected_option?: boolean;
      }[];
    }[];
  };
}

export interface BomStatus {
  ready: boolean;
  runtime_source: 'database' | string;
  product_count: number;
  finished_product_count: number;
  part_count: number;
  latest_updated_at?: string | null;
  latest_source_file?: string;
}

export type CapacityProduct = UploadResult['capacity_analysis']['products'][number];
