from pydantic import BaseModel, Field, EmailStr
from typing import Optional, List, Dict
from datetime import datetime
from models import UserRole, OrderStatus, DocType, SupplierCategory


# ===== User Schemas =====


class UserBase(BaseModel):
    username: str
    role: UserRole
    supplier_name: Optional[str] = None


class UserCreate(UserBase):
    password: str


class UserLogin(BaseModel):
    username: str
    password: str
    role: UserRole


class UserResponse(UserBase):
    id: int
    is_super_admin: bool = False
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True


class Token(BaseModel):
    access_token: str
    token_type: str
    user: UserResponse


class InternalUserCreate(BaseModel):
    username: str
    password: str
    role: UserRole
    is_super_admin: bool = False


class InternalUserUpdate(BaseModel):
    username: str
    is_super_admin: Optional[bool] = None


class InternalUserResponse(BaseModel):
    id: int
    username: str
    role: UserRole
    is_super_admin: bool = False
    created_at: datetime

    class Config:
        from_attributes = True


class SelfProfileUpdateRequest(BaseModel):
    username: str


class InternalUserPasswordUpdateRequest(BaseModel):
    new_password: str
    confirm_password: str


class SelfPasswordUpdateRequest(BaseModel):
    new_password: str
    confirm_password: str


# ===== Document Schemas =====


class DocumentFile(BaseModel):
    type: DocType
    fileName: Optional[str] = None
    uploadedAt: Optional[datetime] = None
    url: Optional[str] = None
    downloadUrl: Optional[str] = None

    class Config:
        from_attributes = True


# ===== Log Schemas =====


class LogEntry(BaseModel):
    timestamp: datetime
    action: str
    actor: str
    details: Optional[str] = None

    class Config:
        from_attributes = True


# ===== Order Schemas =====


class PurchaseOrderBase(BaseModel):
    id: str  # PO Number
    partNumber: str
    partName: str
    supplierName: str


class PurchaseOrderCreate(PurchaseOrderBase):
    pass


class PurchaseOrderResponse(PurchaseOrderBase):
    status: OrderStatus
    documents: Dict[DocType, DocumentFile]
    logs: List[LogEntry]
    rejectReason: Optional[str] = None

    class Config:
        from_attributes = True


class PurchaseOrderUpdate(BaseModel):
    status: Optional[OrderStatus] = None
    rejectReason: Optional[str] = None


# ===== File Upload =====


class FileUploadResponse(BaseModel):
    success: bool
    message: str
    document: DocumentFile


# ===== Admin Actions =====


class ApproveRequest(BaseModel):
    orderId: str


class DocumentHistoryResponse(BaseModel):
    id: int
    fileName: str
    uploadedAt: datetime
    partNumber: str
    orderId: str


class ReuseDocumentRequest(BaseModel):
    sourceDocId: int
    docType: str


# ===== IQC Actions =====


class ReceiveRequest(BaseModel):
    orderId: str


# ===== Supplier Management Schemas =====


class SupplierContactBase(BaseModel):
    name: str
    position: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    is_primary: bool = False


class SupplierContactCreate(SupplierContactBase):
    pass


class SupplierContactResponse(SupplierContactBase):
    id: int
    supplier_id: int

    class Config:
        from_attributes = True


class SupplierBase(BaseModel):
    name: str  # 供应商全称
    code: Optional[str] = None
    category: List[str]  # 物料类别
    address: Optional[str] = None  # 公司地址
    office_phone: Optional[str] = None  # 座机
    fax: Optional[str] = None  # 传真
    website: Optional[str] = None
    business_license: Optional[str] = None
    is_new: bool = False  # 是否新增供应商
    is_site_inspected: bool = False  # 是否现场考察
    notes: Optional[str] = None


class SupplierCreate(SupplierBase):
    """创建供应商时的请求"""

    create_account: bool = True  # 是否同时创建账户
    password: Optional[str] = None  # 如果创建账户,密码(可选,系统可生成)
    contacts: List[SupplierContactCreate] = []


class SupplierUpdate(BaseModel):
    """更新供应商信息"""

    name: Optional[str] = None
    code: Optional[str] = None
    category: Optional[List[str]] = None
    address: Optional[str] = None
    office_phone: Optional[str] = None
    fax: Optional[str] = None
    website: Optional[str] = None
    business_license: Optional[str] = None
    is_new: Optional[bool] = None
    is_site_inspected: Optional[bool] = None
    notes: Optional[str] = None
    is_active: Optional[bool] = None


class SupplierDocumentResponse(BaseModel):
    id: int
    supplier_id: int
    doc_type: str
    file_name: Optional[str]
    file_path: Optional[str]
    uploaded_at: datetime
    expiry_date: Optional[datetime]

    class Config:
        from_attributes = True


class SupplierResponse(SupplierBase):
    id: int
    is_active: bool
    created_at: datetime  # 导入时间
    updated_at: datetime
    has_account: bool = False  # 是否有关联账户
    account_username: Optional[str] = None  # 账户用户名
    account_password: Optional[str] = None  # 账户密码(明文,仅管理员可见)
    total_orders: int = 0  # 历史订单数
    pending_orders: int = 0  # 待处理订单数
    incomplete_orders: int = 0  # 资料未齐订单数
    orders: List[dict] = []  # 订单列表
    contacts: List[SupplierContactResponse] = []
    documents: List[SupplierDocumentResponse] = []
    contact_phone: Optional[str] = None
    is_deleted: bool
    deleted_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class SupplierCreateResponse(BaseModel):
    """创建供应商后的响应,包含生成的账户信息"""

    supplier: SupplierResponse
    account: Optional[dict] = None  # {username, password} 如果创建了账户


class SupplierStats(BaseModel):
    """供应商统计信息"""

    total_suppliers: int
    active_suppliers: int
    total_pending_review: int  # 全局待审核订单数
    suppliers_with_incomplete: int  # 有未齐套订单的供应商数
    category_counts: dict  # 各分类的供应商数量统计


class SupplierDetailStats(BaseModel):
    """单个供应商的详细统计"""

    supplier_id: int
    supplier_name: str
    total_orders: int
    pending_upload: int
    ready_for_review: int
    approved: int
    rejected: int
    received: int
    incomplete_docs: List[str]  # 缺少的文档类型
    similar_suppliers: List[SupplierResponse]  # 同类别的其他供应商


class SupplierBatchRequest(BaseModel):
    ids: List[int]


# ===== PMC / Inventory Schemas =====

class InventoryRecordResponse(BaseModel):
    id: int
    source_email: str
    file_name: Optional[str]
    parsed_at: datetime
    calculated_capacity: int
    bottleneck_material: Optional[str]
    notes: Optional[str]

    class Config:
        from_attributes = True


class InventoryAdjustmentEventResponse(BaseModel):
    id: int
    gmail_message_id: Optional[str]
    gmail_thread_id: Optional[str]
    sender: Optional[str]
    subject: Optional[str]
    body_text: Optional[str]
    actor_name: Optional[str]
    part_no: Optional[str]
    part_name: Optional[str]
    change_type: str
    quantity: Optional[float]
    unit: Optional[str]
    reason: Optional[str]
    parse_confidence: float
    parse_source: str
    status: str
    cycle_id: Optional[int]
    match_count: int
    matched_part_no: Optional[str]
    matched_part_name: Optional[str]
    apply_note: Optional[str]
    previous_record_id: Optional[int]
    new_record_id: Optional[int]
    created_at: datetime
    updated_at: datetime
    applied_at: Optional[datetime]
    rejected_at: Optional[datetime]

    class Config:
        from_attributes = True


class InventoryAdjustmentApplyRequest(BaseModel):
    event_id: int
    part_no: Optional[str] = None
    quantity: Optional[float] = None
    apply_note: Optional[str] = None


class InventoryAdjustmentRejectRequest(BaseModel):
    event_id: int
    apply_note: Optional[str] = None


class InventoryAdjustmentBulkRejectRequest(BaseModel):
    event_ids: List[int]
    apply_note: Optional[str] = None


class InventoryAdjustmentRestoreRequest(BaseModel):
    event_id: int


class InventoryAdjustmentBulkRestoreRequest(BaseModel):
    event_ids: List[int]


class InventoryAdjustmentBulkDeleteRequest(BaseModel):
    event_ids: List[int]


class InventoryAdjustmentCycleRecordInfo(BaseModel):
    id: int
    source_email: str
    file_name: Optional[str]
    parsed_at: datetime

    class Config:
        from_attributes = True


class InventoryAdjustmentSummaryRow(BaseModel):
    part_no: str
    part_name: Optional[str] = None
    base_quantity: float = 0
    outbound_total: float = 0
    inbound_total: float = 0
    return_total: float = 0
    scrap_total: float = 0
    net_change: float = 0
    projected_quantity: float = 0
    current_quantity: float = 0
    actual_delta: float = 0
    variance: float = 0
    is_aligned: bool = True
    event_count: int = 0


class InventoryAdjustmentCycleSummaryTotals(BaseModel):
    affected_part_count: int = 0
    outbound_total: float = 0
    inbound_total: float = 0
    return_total: float = 0
    scrap_total: float = 0
    net_change: float = 0
    actual_net_change: float = 0
    variance_total: float = 0
    aligned_part_count: int = 0
    mismatch_part_count: int = 0


class InventoryAdjustmentCycleSummaryResponse(BaseModel):
    base_record: InventoryAdjustmentCycleRecordInfo
    latest_record: InventoryAdjustmentCycleRecordInfo
    cycle_closed: bool = False
    cycle_id: Optional[int] = None
    locked_at: Optional[datetime] = None
    confirmed_event_count: int
    pending_event_count: int
    totals: InventoryAdjustmentCycleSummaryTotals
    rows: List[InventoryAdjustmentSummaryRow]
