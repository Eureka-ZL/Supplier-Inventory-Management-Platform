export interface PmcHistoryEvent {
  event_type: 'bom_change' | 'inventory_change' | 'audit_log';
  event_time: string;
  event_id: string;
  title: string;
  subtitle?: string;
  operator?: string;
  line?: string;
  product_code?: string;
  product_name?: string;
  source_file?: string;
  summary: Record<string, any>;
  detail: Record<string, any>;
  record_id?: number;
  previous_record_id?: number | null;
  root_product_code?: string;
  root_product_name?: string;
  changed_product_code?: string;
  changed_product_name?: string;
  changed_tier_label?: string;
  is_deleted?: boolean;
  deleted_at?: string | null;
  deleted_by?: string | null;
}
