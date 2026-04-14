export interface BomPart {
  part_no: string;
  name: string;
  spec: string;
  qty: number;
  manufacturer: string;
  alt_group: number | null;
}

export interface BomProduct {
  product_code: string;
  product_name: string;
  category: string;
  line?: string;
  total_parts: number;
  parts: BomPart[];
  file: string;
  source_file?: string;
  is_finished_product?: boolean;
}
