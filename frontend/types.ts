export enum UserRole {
  SUPPLIER = 'SUPPLIER',
  ADMIN = 'ADMIN',
  IQC = 'IQC',
  PMC = 'PMC'
}

export interface AuthUser {
  id: number;
  username: string;
  role: UserRole;
  is_super_admin?: boolean;
  supplier_name?: string;
  is_active?: boolean;
  created_at?: string;
}

export interface InternalUserAccount {
  id: number;
  username: string;
  role: UserRole;
  is_super_admin?: boolean;
  created_at: string;
}

export enum OrderStatus {
  PENDING_UPLOAD = '待补料',
  READY_FOR_REVIEW = '待审核', // 齐套，已提交
  APPROVED = '已核准',
  REJECTED = '已驳回',
  RECEIVED = '已收货'
}

export enum DocType {
  MSDS = 'MSDS',
  ROHS = 'RoHS报告',
  REACH = 'REACH报告',
  SPEC = '承认书',
  REPORT = '进料检验报告',
  OTHER = '其他'
}

export interface DocumentFile {
  type: DocType;
  fileName: string | null;
  uploadedAt: string | null;
  url: string | null;
  downloadUrl?: string | null;
}

export interface LogEntry {
  timestamp: string;
  action: string;
  actor: string; // role or name
  details?: string;
}

export interface PurchaseOrder {
  id: string; // PO Number
  partNumber: string;
  partName: string;
  supplierName: string;
  status: OrderStatus;
  documents: Record<DocType, DocumentFile>;
  logs: LogEntry[];
  rejectReason?: string;
}

export const REQUIRED_DOCS = [DocType.MSDS, DocType.ROHS, DocType.SPEC, DocType.REPORT, DocType.OTHER];

export enum SupplierCategory {
  STRUCTURE_ELECTROMECHANICAL = '结构&机电',
  ELECTRONICS = '电子元器件',
  ACCESSORIES_PACKAGING = '附配件及包材',
  PROTOTYPE = '手板',
  TEST_CERTIFICATION = '测试认证',
  OTHER = '其他'
}

export interface SupplierContact {
  id: number;
  supplier_id: number;
  name?: string;  // 联系人姓名
  position?: string;  // 职务
  phone?: string;  // 手机
  email?: string;  // 邮箱
  is_primary: boolean;  // 是否主要联系人
}

export interface SupplierDocument {
  id: number;
  supplier_id: number;
  doc_type: string;
  file_name: string | null;
  file_path: string | null;
  uploaded_at: string;
  expiry_date?: string | null;
}

export interface Supplier {
  id: number;
  name: string;  // 供应商全称
  code?: string;
  category: string[];  // 物料类别
  address?: string;  // 公司地址
  office_phone?: string;  // 供应商座机
  fax?: string;  // 供应商传真
  website?: string;
  business_license?: string;
  notes?: string;
  is_active: boolean;
  is_new: boolean;  // 是否新增
  is_site_inspected: boolean;  // 是否现场考察
  created_at: string;  // 导入时间
  updated_at: string;
  is_deleted: boolean;
  deleted_at: string | null;
  has_account: boolean;
  account_username?: string;
  account_password?: string;
  total_orders: number;
  pending_orders: number;
  incomplete_orders: number;
  orders: SupplierOrder[];
  contacts: SupplierContact[];  // 联系人列表
  documents: SupplierDocument[]; // 供应商级文档

  // 保留向后兼容字段(来自第一个联系人)
  contact_person?: string;
  contact_position?: string;
  contact_phone?: string;
  email?: string;
}

export interface SupplierOrder {
  id: string;
  partNumber: string;
  partName: string;
  status: string;
  createdAt: string;
  documentsUploaded: number;
  documentsTotal: number;
  rejectReason?: string;
  documents: Array<{
    id: number;
    doc_type: string;  // SPEC, ROHS, MSDS, REPORT
    document_type: string;  // 中文名称
    file_name: string | null;
    uploaded_at: string | null;
  }>;
}

export interface SupplierStats {
  total_suppliers: number;
  active_suppliers: number;
  total_pending_review: number;
  suppliers_with_incomplete: number;
  category_counts: Record<string, number>;
}

export interface SupplierDetailStats {
  supplier_id: number;
  supplier_name: string;
  total_orders: number;
  pending_upload: number;
  ready_for_review: number;
  approved: number;
  rejected: number;
  received: number;
  incomplete_docs: string[];
  similar_suppliers: Supplier[];
}
