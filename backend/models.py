from sqlalchemy import (
    Column,
    String,
    Integer,
    Float,
    DateTime,
    ForeignKey,
    Enum as SQLEnum,
    Text,
    Boolean,
    ARRAY,
)
from sqlalchemy.orm import relationship
from datetime import datetime
import enum
from database import Base


class UserRole(str, enum.Enum):
    SUPPLIER = "SUPPLIER"
    ADMIN = "ADMIN"
    IQC = "IQC"
    PMC = "PMC"


class OrderStatus(str, enum.Enum):
    PENDING_UPLOAD = "待补料"
    READY_FOR_REVIEW = "待审核"
    APPROVED = "已核准"
    REJECTED = "已驳回"
    RECEIVED = "已收货"


class DocType(str, enum.Enum):
    MSDS = "MSDS"
    ROHS = "RoHS报告"
    REACH = "REACH报告"
    SPEC = "承认书"
    REPORT = "进料检验报告"
    OTHER = "其他"


class SupplierCategory(str, enum.Enum):
    STRUCTURE_ELECTROMECHANICAL = "结构&机电"
    ELECTRONICS = "电子元器件"
    ACCESSORIES_PACKAGING = "附配件及包材"
    PROTOTYPE = "手板"
    TEST_CERTIFICATION = "测试认证"
    OTHER = "其他"


class Supplier(Base):
    __tablename__ = "suppliers"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(200), unique=True, index=True, nullable=False)  # 供应商全称
    code = Column(String(50), unique=True, index=True, nullable=True)  # 供应商编码
    category = Column(ARRAY(String), nullable=False)  # 物料类别 (List of strings)
    address = Column(String(500), nullable=True)  # 公司地址
    office_phone = Column(String(100), nullable=True)  # 座机
    fax = Column(String(100), nullable=True)  # 传真
    website = Column(String(200), nullable=True)
    business_license = Column(String(100), nullable=True)  # 营业执照号
    is_active = Column(Boolean, default=True)
    is_new = Column(Boolean, default=False, nullable=False)  # 是否新增供应商
    is_site_inspected = Column(Boolean, default=False, nullable=False)  # 是否现场考察
    created_at = Column(DateTime, default=datetime.utcnow)  # 导入时间
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    is_deleted = Column(Boolean, default=False, nullable=False)
    deleted_at = Column(DateTime, nullable=True)
    notes = Column(Text, nullable=True)

    # Relationships
    contacts = relationship(
        "SupplierContact", back_populates="supplier", cascade="all, delete-orphan"
    )
    documents = relationship(
        "SupplierDocument", back_populates="supplier", cascade="all, delete-orphan"
    )
    # user will be linked via supplier_name (legacy) or we can add supplier_id to User


class SupplierDocument(Base):
    __tablename__ = "supplier_documents"

    id = Column(Integer, primary_key=True, index=True)
    supplier_id = Column(Integer, ForeignKey("suppliers.id"), nullable=False)
    doc_type = Column(String(50), nullable=False)  # e.g 'REACH'
    file_name = Column(String(255), nullable=True)
    file_path = Column(String(500), nullable=True)  # MinIO object key
    uploaded_at = Column(DateTime, default=datetime.utcnow)
    expiry_date = Column(DateTime, nullable=True)

    supplier = relationship("Supplier", back_populates="documents")


class SupplierContact(Base):
    __tablename__ = "supplier_contacts"

    id = Column(Integer, primary_key=True, index=True)
    supplier_id = Column(Integer, ForeignKey("suppliers.id"), nullable=False)
    name = Column(String(100), nullable=True)  # 联系人姓名
    position = Column(String(100), nullable=True)  # 职务
    phone = Column(String(100), nullable=True)  # 手机
    email = Column(String(100), nullable=True)  # 邮箱
    is_primary = Column(Boolean, default=False)  # 是否主要联系人

    supplier = relationship("Supplier", back_populates="contacts")


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(100), unique=True, index=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    plain_password = Column(String(100), nullable=True)  # 仅供应商账户存储,管理员可查看
    role = Column(SQLEnum(UserRole), nullable=False)
    is_super_admin = Column(Boolean, default=False, nullable=False)
    supplier_name = Column(String(200), nullable=True)  # Only for SUPPLIER role
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    orders_created = relationship(
        "PurchaseOrder",
        back_populates="creator",
        foreign_keys="PurchaseOrder.created_by",
    )


class PurchaseOrder(Base):
    __tablename__ = "purchase_orders"

    id = Column(String(100), primary_key=True)  # PO Number
    part_number = Column(String(100), nullable=False)
    part_name = Column(String(200), nullable=False)
    supplier_name = Column(String(200), nullable=False, index=True)
    status = Column(
        SQLEnum(OrderStatus),
        default=OrderStatus.PENDING_UPLOAD,
        nullable=False,
        index=True,
    )
    reject_reason = Column(Text, nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    creator = relationship(
        "User", back_populates="orders_created", foreign_keys=[created_by]
    )
    documents = relationship(
        "Document", back_populates="order", cascade="all, delete-orphan"
    )
    logs = relationship(
        "OrderLog",
        back_populates="order",
        cascade="all, delete-orphan",
        order_by="OrderLog.timestamp",
    )


class Document(Base):
    __tablename__ = "documents"

    id = Column(Integer, primary_key=True, index=True)
    order_id = Column(String(100), ForeignKey("purchase_orders.id"), nullable=False)
    doc_type = Column(SQLEnum(DocType), nullable=False)
    file_name = Column(String(255), nullable=True)
    file_path = Column(String(500), nullable=True)  # MinIO object key
    file_url = Column(String(500), nullable=True)  # Presigned URL (temporary)
    uploaded_at = Column(DateTime, nullable=True)
    uploaded_by = Column(Integer, ForeignKey("users.id"), nullable=True)

    # Relationships
    order = relationship("PurchaseOrder", back_populates="documents")


class OrderLog(Base):
    __tablename__ = "order_logs"

    id = Column(Integer, primary_key=True, index=True)
    order_id = Column(String(100), ForeignKey("purchase_orders.id"), nullable=False)
    timestamp = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    action = Column(String(200), nullable=False)
    actor = Column(String(200), nullable=False)  # Username or role
    details = Column(Text, nullable=True)

    # Relationships
    order = relationship("PurchaseOrder", back_populates="logs")


class InventoryRecord(Base):
    __tablename__ = "inventory_records"

    id = Column(Integer, primary_key=True, index=True)
    source_email = Column(String(200), nullable=False)  # 来源邮箱或标识
    file_name = Column(String(255), nullable=True)  # 解析附件名
    parsed_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    raw_data = Column(Text, nullable=True)  # 存储解析的原始JSON，以备查
    calculated_capacity = Column(Integer, nullable=False, default=0)  # 计算出的可生产台数
    bottleneck_material = Column(String(255), nullable=True)  # 瓶颈物料编码/名称
    notes = Column(Text, nullable=True)


class InventoryReconciliationCycle(Base):
    __tablename__ = "inventory_reconciliation_cycles"

    id = Column(Integer, primary_key=True, index=True)
    base_record_id = Column(Integer, ForeignKey("inventory_records.id"), nullable=False, index=True)
    closing_record_id = Column(Integer, ForeignKey("inventory_records.id"), nullable=True, index=True)
    status = Column(String(20), nullable=False, default="open", index=True)
    note = Column(Text, nullable=True)
    locked_at = Column(DateTime, nullable=True, index=True)
    locked_by = Column(String(100), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class InventoryAdjustmentEvent(Base):
    __tablename__ = "inventory_adjustment_events"

    id = Column(Integer, primary_key=True, index=True)
    gmail_message_id = Column(String(255), nullable=True, index=True, unique=True)
    gmail_thread_id = Column(String(255), nullable=True, index=True)
    sender = Column(String(255), nullable=True, index=True)
    subject = Column(String(500), nullable=True)
    body_text = Column(Text, nullable=True)
    actor_name = Column(String(100), nullable=True)
    part_no = Column(String(100), nullable=True, index=True)
    part_name = Column(String(255), nullable=True)
    change_type = Column(String(50), nullable=False, default="unknown", index=True)
    quantity = Column(Float, nullable=True)
    unit = Column(String(50), nullable=True)
    reason = Column(String(255), nullable=True)
    parse_confidence = Column(Float, nullable=False, default=0)
    parse_source = Column(String(50), nullable=False, default="rule")
    status = Column(String(50), nullable=False, default="pending", index=True)
    cycle_id = Column(Integer, ForeignKey("inventory_reconciliation_cycles.id"), nullable=True, index=True)
    match_count = Column(Integer, nullable=False, default=0)
    matched_part_no = Column(String(100), nullable=True)
    matched_part_name = Column(String(255), nullable=True)
    apply_note = Column(Text, nullable=True)
    previous_record_id = Column(Integer, ForeignKey("inventory_records.id"), nullable=True, index=True)
    new_record_id = Column(Integer, ForeignKey("inventory_records.id"), nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    applied_at = Column(DateTime, nullable=True)
    rejected_at = Column(DateTime, nullable=True)


class BomProduct(Base):
    __tablename__ = "bom_products"

    id = Column(Integer, primary_key=True, index=True)
    product_code = Column(String(50), unique=True, index=True, nullable=False)
    product_name = Column(String(255), nullable=False)
    line = Column(String(100), nullable=True)
    source_file = Column(String(255), nullable=True)
    is_finished_product = Column(Boolean, default=False, nullable=False)
    imported_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    parts = relationship(
        "BomProductPart",
        back_populates="product",
        cascade="all, delete-orphan",
        order_by="BomProductPart.row_no",
    )


class BomProductPart(Base):
    __tablename__ = "bom_product_parts"

    id = Column(Integer, primary_key=True, index=True)
    bom_product_id = Column(Integer, ForeignKey("bom_products.id"), nullable=False, index=True)
    row_no = Column(Integer, nullable=False, default=1)
    part_no = Column(String(50), nullable=False, index=True)
    name = Column(String(255), nullable=True)
    spec = Column(Text, nullable=True)
    qty = Column(Float, nullable=False, default=1)
    manufacturer = Column(String(255), nullable=True)
    alt_group = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    product = relationship("BomProduct", back_populates="parts")


class BomProductOverride(Base):
    # Legacy table kept only for one-time bootstrap merge from older override data.
    # Runtime BOM reads/writes now use BomProduct / BomProductPart exclusively.
    __tablename__ = "bom_product_overrides"

    id = Column(Integer, primary_key=True, index=True)
    product_code = Column(String(50), unique=True, index=True, nullable=False)
    product_name = Column(String(255), nullable=True)
    line = Column(String(100), nullable=True)
    source_file = Column(String(255), nullable=True)
    parts_json = Column(Text, nullable=False)
    updated_by = Column(String(100), nullable=True)
    published_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)


class BomChangeLog(Base):
    __tablename__ = "bom_change_logs"

    id = Column(Integer, primary_key=True, index=True)
    changed_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    changed_by = Column(String(100), nullable=True)
    product_code = Column(String(50), nullable=False, index=True)
    product_name = Column(String(255), nullable=True)
    line = Column(String(100), nullable=True)
    source_file = Column(String(255), nullable=True)
    summary_json = Column(Text, nullable=False)
    detail_json = Column(Text, nullable=False)
    is_deleted = Column(Boolean, default=False, nullable=False, index=True)
    deleted_at = Column(DateTime, nullable=True)
    deleted_by = Column(String(100), nullable=True)


class InventoryChangeLog(Base):
    __tablename__ = "inventory_change_logs"

    id = Column(Integer, primary_key=True, index=True)
    changed_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    source = Column(String(50), nullable=False, default="unknown")
    source_email = Column(String(255), nullable=True)
    file_name = Column(String(255), nullable=True)
    record_id = Column(Integer, ForeignKey("inventory_records.id"), nullable=False, index=True)
    previous_record_id = Column(Integer, ForeignKey("inventory_records.id"), nullable=True, index=True)
    summary_json = Column(Text, nullable=False)
    detail_json = Column(Text, nullable=False)
    is_deleted = Column(Boolean, default=False, nullable=False, index=True)
    deleted_at = Column(DateTime, nullable=True)
    deleted_by = Column(String(100), nullable=True)


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    scope = Column(String(50), nullable=False, default="system", index=True)
    action = Column(String(100), nullable=False, index=True)
    actor = Column(String(100), nullable=True, index=True)
    entity_type = Column(String(100), nullable=False, index=True)
    entity_id = Column(String(100), nullable=True, index=True)
    title = Column(String(255), nullable=False)
    summary = Column(Text, nullable=True)
    detail_json = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    is_deleted = Column(Boolean, default=False, nullable=False, index=True)
    deleted_at = Column(DateTime, nullable=True)
    deleted_by = Column(String(100), nullable=True)
