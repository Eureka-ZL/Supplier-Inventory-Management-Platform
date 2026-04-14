from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_, any_
from sqlalchemy.orm import selectinload
from typing import List, Optional
import models
import schemas
from database import get_db
from routers.auth import ensure_super_admin, get_current_user, get_password_hash, is_super_admin
from storage import minio_client
import secrets
import string
import os

router = APIRouter(prefix="/api/suppliers", tags=["Suppliers"])

# 供应商分类映射：前端key -> 数据库中文名称
CATEGORY_MAP = {
    "STRUCTURE_ELECTROMECHANICAL": "结构&机电",
    "ELECTRONICS": "电子元器件",
    "ACCESSORIES_PACKAGING": "附配件及包材",
    "PROTOTYPE": "手板",
    "TEST_CERTIFICATION": "测试认证",
    "OTHER": "其他",
}


def generate_password(length=12):
    """生成随机密码"""
    alphabet = string.ascii_letters + string.digits + "!@#$%"
    password = "".join(secrets.choice(alphabet) for i in range(length))
    return password


@router.get("/stats", response_model=schemas.SupplierStats)
async def get_supplier_stats(
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """获取供应商总体统计信息 (仅管理员)"""
    if current_user.role != models.UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="Only admins can access stats")

    # 统计总供应商数和活跃数
    result = await db.execute(select(func.count(models.Supplier.id)))
    total_suppliers = result.scalar() or 0

    result = await db.execute(
        select(func.count(models.Supplier.id)).where(models.Supplier.is_active == True)
    )
    active_suppliers = result.scalar() or 0

    # 统计待审核订单数
    result = await db.execute(
        select(func.count(models.PurchaseOrder.id)).where(
            models.PurchaseOrder.status == models.OrderStatus.READY_FOR_REVIEW
        )
    )
    total_pending_review = result.scalar() or 0

    # 统计资料缺失的供应商数：当前以缺少供应商级 REACH 为准
    result = await db.execute(
        select(func.count(models.Supplier.id)).where(
            and_(
                models.Supplier.is_deleted == False,
                ~models.Supplier.documents.any(
                    and_(
                        func.upper(models.SupplierDocument.doc_type).like("%REACH%"),
                        models.SupplierDocument.file_name.is_not(None),
                    )
                ),
            )
        )
    )
    suppliers_with_incomplete = result.scalar() or 0

    # 统计各分类的供应商数量
    result = await db.execute(select(models.Supplier.category))
    all_categories = result.scalars().all()

    # 统计每个分类的数量
    category_counts = {}
    for categories in all_categories:
        if categories:  # 确保不是 None
            for cat in categories:
                category_counts[cat] = category_counts.get(cat, 0) + 1

    return schemas.SupplierStats(
        total_suppliers=total_suppliers,
        active_suppliers=active_suppliers,
        total_pending_review=total_pending_review,
        suppliers_with_incomplete=suppliers_with_incomplete,
        category_counts=category_counts,
    )


@router.get("/", response_model=List[schemas.SupplierResponse])
async def list_suppliers(
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    category: str = None,
    is_active: bool = None,
):
    """获取供应商列表 (仅管理员和IQC)"""
    if current_user.role not in [models.UserRole.ADMIN, models.UserRole.IQC]:
        raise HTTPException(status_code=403, detail="Access denied")

    query = select(models.Supplier).options(
        selectinload(models.Supplier.contacts), selectinload(models.Supplier.documents)
    )

    # 默认只显示未删除的供应商
    query = query.where(models.Supplier.is_deleted == False)

    # 过滤条件
    if category:
        # 将前端传递的英文key转换为数据库中的中文名称
        db_category = CATEGORY_MAP.get(category, category)
        # Filter if the category array contains the requested category
        query = query.where(models.Supplier.category.any(db_category))

    if is_active is not None:
        query = query.where(models.Supplier.is_active == is_active)

    query = query.order_by(models.Supplier.created_at.desc())

    result = await db.execute(query)
    suppliers = result.scalars().all()

    # 为每个供应商添加统计信息和订单列表
    response = []
    for supplier in suppliers:
        # 检查是否有关联账户并获取密码
        user_result = await db.execute(
            select(models.User).where(models.User.supplier_name == supplier.name)
        )
        user = user_result.scalar_one_or_none()
        has_account = user is not None
        can_manage_supplier_accounts = is_super_admin(current_user)
        account_username = user.username if user and can_manage_supplier_accounts else None
        account_password = user.plain_password if user and can_manage_supplier_accounts else None

        # 获取订单列表
        orders_result = await db.execute(
            select(models.PurchaseOrder)
            .where(models.PurchaseOrder.supplier_name == supplier.name)
            .options(selectinload(models.PurchaseOrder.documents))
            .order_by(models.PurchaseOrder.created_at.desc())
        )
        orders = orders_result.scalars().all()

        # 统计订单数
        total_orders = len(orders)

        pending_orders = sum(
            1
            for o in orders
            if o.status
            in [models.OrderStatus.PENDING_UPLOAD, models.OrderStatus.READY_FOR_REVIEW]
        )

        incomplete_orders = sum(
            1 for o in orders if o.status == models.OrderStatus.PENDING_UPLOAD
        )

        # 构建订单列表
        orders_list = []
        for order in orders:
            # 计算文档完成度
            total_docs = len(order.documents)
            uploaded_docs = sum(
                1 for doc in order.documents if doc.file_name is not None
            )

            orders_list.append(
                {
                    "id": order.id,
                    "partNumber": order.part_number,
                    "partName": order.part_name,
                    "status": order.status.value,
                    "createdAt": order.created_at.isoformat(),
                    "documentsUploaded": uploaded_docs,
                    "documentsTotal": total_docs,
                    "rejectReason": order.reject_reason,
                    "documents": [
                        {
                            "id": doc.id,
                            "doc_type": doc.doc_type.name,  # 枚举key: SPEC, ROHS, MSDS, REPORT
                            "document_type": doc.doc_type.value,  # 中文名称
                            "file_name": doc.file_name,
                            "uploaded_at": (
                                doc.uploaded_at.isoformat() if doc.uploaded_at else None
                            ),
                        }
                        for doc in order.documents
                    ],
                }
            )

        response.append(
            schemas.SupplierResponse(
                id=supplier.id,
                name=supplier.name,
                code=supplier.code,
                category=supplier.category,
                address=supplier.address,
                office_phone=supplier.office_phone,
                fax=supplier.fax,
                website=supplier.website,
                business_license=supplier.business_license,
                is_new=supplier.is_new,
                is_site_inspected=supplier.is_site_inspected,
                notes=supplier.notes,
                is_active=supplier.is_active,
                created_at=supplier.created_at,
                updated_at=supplier.updated_at,
                is_deleted=supplier.is_deleted,
                deleted_at=supplier.deleted_at,
                has_account=has_account,
                account_username=account_username,
                account_password=account_password,
                total_orders=total_orders,
                pending_orders=pending_orders,
                incomplete_orders=incomplete_orders,
                orders=orders_list,
                contacts=[
                    schemas.SupplierContactResponse.model_validate(c)
                    for c in supplier.contacts
                ],
                documents=[
                    {
                        "id": d.id,
                        "supplier_id": d.supplier_id,
                        "doc_type": d.doc_type,
                        "file_name": d.file_name,
                        "file_path": d.file_path,
                        "uploaded_at": d.uploaded_at,
                        "expiry_date": d.expiry_date,
                    }
                    for d in supplier.documents
                ],
            )
        )

    return response


@router.post("/documents", response_model=schemas.SupplierDocumentResponse)
async def upload_supplier_document(
    doc_type: str,
    file: UploadFile = File(...),
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Supplier uploads a document (e.g. REACH)"""
    if current_user.role != models.UserRole.SUPPLIER:
        raise HTTPException(
            status_code=403, detail="Only suppliers can upload documents here"
        )

    # Get supplier
    result = await db.execute(
        select(models.Supplier).where(
            models.Supplier.name == current_user.supplier_name
        )
    )
    supplier = result.scalar_one_or_none()
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier profile not found")

    # Check valid doc types (Currently only REACH)
    if doc_type not in ["REACH"]:
        raise HTTPException(status_code=400, detail="Invalid document type")

    # Remove existing doc of same type
    result = await db.execute(
        select(models.SupplierDocument).where(
            and_(
                models.SupplierDocument.supplier_id == supplier.id,
                models.SupplierDocument.doc_type == doc_type,
            )
        )
    )
    existing_doc = result.scalar_one_or_none()
    if existing_doc:
        # Delete file from MinIO
        if existing_doc.file_path:
            minio_client.delete_file(existing_doc.file_path)
        await db.delete(existing_doc)

    # Upload new file
    file_ext = os.path.splitext(file.filename)[1]
    object_name = f"suppliers/{supplier.id}/{doc_type}_{secrets.token_hex(4)}{file_ext}"

    file_content = await file.read()
    if not minio_client.upload_file(file_content, object_name, file.content_type):
        raise HTTPException(status_code=500, detail="Failed to upload file")

    new_doc = models.SupplierDocument(
        supplier_id=supplier.id,
        doc_type=doc_type,
        file_name=file.filename,
        file_path=object_name,
    )
    db.add(new_doc)
    await db.commit()
    await db.refresh(new_doc)

    return new_doc


@router.get("/documents", response_model=List[schemas.SupplierDocumentResponse])
async def list_my_documents(
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List current supplier's documents"""
    if current_user.role != models.UserRole.SUPPLIER:
        raise HTTPException(status_code=403, detail="Only suppliers can access this")

    result = await db.execute(
        select(models.Supplier).where(
            models.Supplier.name == current_user.supplier_name
        )
    )
    supplier = result.scalar_one_or_none()
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier profile not found")

    result = await db.execute(
        select(models.SupplierDocument).where(
            models.SupplierDocument.supplier_id == supplier.id
        )
    )
    return result.scalars().all()


@router.get("/documents/{doc_id}/view")
async def view_supplier_document(
    doc_id: int,
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """View a supplier document (inline)"""
    # Verify access
    if current_user.role == models.UserRole.SUPPLIER:
        # Supplier can only access their own docs
        result = await db.execute(
            select(models.Supplier).where(
                models.Supplier.name == current_user.supplier_name
            )
        )
        supplier = result.scalar_one_or_none()
        if not supplier:
            raise HTTPException(status_code=403, detail="Access denied")

        doc_result = await db.execute(
            select(models.SupplierDocument).where(
                and_(
                    models.SupplierDocument.id == doc_id,
                    models.SupplierDocument.supplier_id == supplier.id,
                )
            )
        )
    elif current_user.role in [models.UserRole.ADMIN, models.UserRole.IQC]:
        # Admin/IQC can access any doc
        doc_result = await db.execute(
            select(models.SupplierDocument).where(models.SupplierDocument.id == doc_id)
        )
    else:
        raise HTTPException(status_code=403, detail="Access denied")

    doc = doc_result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    # Generate presigned URL for inline view
    url = minio_client.get_presigned_url(doc.file_path, response_disposition="inline")
    if not url:
        raise HTTPException(status_code=404, detail="File not found in storage")

    return {"url": url}


@router.get("/documents/{doc_id}/download")
async def download_supplier_document(
    doc_id: int,
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Download a supplier document (attachment)"""
    # Verify access (Same logic as view)
    if current_user.role == models.UserRole.SUPPLIER:
        result = await db.execute(
            select(models.Supplier).where(
                models.Supplier.name == current_user.supplier_name
            )
        )
        supplier = result.scalar_one_or_none()
        if not supplier:
            raise HTTPException(status_code=403, detail="Access denied")

        doc_result = await db.execute(
            select(models.SupplierDocument).where(
                and_(
                    models.SupplierDocument.id == doc_id,
                    models.SupplierDocument.supplier_id == supplier.id,
                )
            )
        )
    elif current_user.role in [models.UserRole.ADMIN, models.UserRole.IQC]:
        doc_result = await db.execute(
            select(models.SupplierDocument).where(models.SupplierDocument.id == doc_id)
        )
    else:
        raise HTTPException(status_code=403, detail="Access denied")

    doc = doc_result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    # Generate presigned URL for attachment
    url = minio_client.get_presigned_url(
        doc.file_path, response_disposition="attachment"
    )
    if not url:
        raise HTTPException(status_code=404, detail="File not found in storage")

    return {"url": url}


@router.post(
    "/",
    response_model=schemas.SupplierCreateResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_supplier(
    supplier_data: schemas.SupplierCreate,
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """创建新供应商 (仅管理员)"""
    ensure_super_admin(current_user, "Only super admins can create suppliers")

    # 检查供应商名称是否已存在
    result = await db.execute(
        select(models.Supplier).where(models.Supplier.name == supplier_data.name)
    )
    if result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Supplier name already exists")

    # 检查供应商编码是否已存在
    if supplier_data.code:
        result = await db.execute(
            select(models.Supplier).where(models.Supplier.code == supplier_data.code)
        )
        if result.scalar_one_or_none():
            raise HTTPException(status_code=400, detail="Supplier code already exists")

    # 创建供应商
    new_supplier = models.Supplier(
        name=supplier_data.name,
        code=supplier_data.code,
        category=supplier_data.category,
        address=supplier_data.address,
        website=supplier_data.website,
        business_license=supplier_data.business_license,
        is_new=supplier_data.is_new,
        is_site_inspected=supplier_data.is_site_inspected,
        notes=supplier_data.notes,
    )
    db.add(new_supplier)
    await db.flush()  # 获取ID

    # 创建联系人
    for contact_data in supplier_data.contacts:
        new_contact = models.SupplierContact(
            supplier_id=new_supplier.id,
            name=contact_data.name,
            position=contact_data.position,
            phone=contact_data.phone,
            email=contact_data.email,
            is_primary=contact_data.is_primary,
        )
        db.add(new_contact)

    await db.commit()
    # 重新加载以获取联系人
    result = await db.execute(
        select(models.Supplier)
        .where(models.Supplier.id == new_supplier.id)
        .options(selectinload(models.Supplier.contacts))
    )
    new_supplier = result.scalar_one()

    account_info = None

    # 如果需要创建账户
    if supplier_data.create_account:
        # 生成用户名 (供应商名称)
        username = supplier_data.name

        # 检查用户名是否已存在
        result = await db.execute(
            select(models.User).where(models.User.username == username)
        )
        if result.scalar_one_or_none():
            raise HTTPException(
                status_code=400,
                detail=f"Username '{username}' already exists. Please use a different supplier name or create account manually.",
            )

        # 生成或使用提供的密码
        password = supplier_data.password or generate_password()

        # 创建用户账户(保存明文密码供管理员查看)
        new_user = models.User(
            username=username,
            hashed_password=get_password_hash(password),
            plain_password=password,  # 保存明文密码
            role=models.UserRole.SUPPLIER,
            is_super_admin=False,
            supplier_name=supplier_data.name,
        )
        db.add(new_user)
        await db.commit()

        account_info = {"username": username, "password": password}

    # 构建响应
    supplier_response = schemas.SupplierResponse(
        id=new_supplier.id,
        name=new_supplier.name,
        code=new_supplier.code,
        category=new_supplier.category,
        address=new_supplier.address,
        office_phone=new_supplier.office_phone,
        fax=new_supplier.fax,
        website=new_supplier.website,
        business_license=new_supplier.business_license,
        is_new=new_supplier.is_new,
        is_site_inspected=new_supplier.is_site_inspected,
        notes=new_supplier.notes,
        is_active=new_supplier.is_active,
        created_at=new_supplier.created_at,
        updated_at=new_supplier.updated_at,
        has_account=account_info is not None,
        total_orders=0,
        pending_orders=0,
        incomplete_orders=0,
        contacts=[
            schemas.SupplierContactResponse.model_validate(c)
            for c in new_supplier.contacts
        ],
    )

    return schemas.SupplierCreateResponse(
        supplier=supplier_response, account=account_info
    )


@router.get("/{supplier_id}", response_model=schemas.SupplierDetailStats)
async def get_supplier_details(
    supplier_id: int,
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """获取供应商详细信息和统计 (仅管理员和IQC)"""
    if current_user.role not in [models.UserRole.ADMIN, models.UserRole.IQC]:
        raise HTTPException(status_code=403, detail="Access denied")

    # 获取供应商
    result = await db.execute(
        select(models.Supplier).where(models.Supplier.id == supplier_id)
    )
    supplier = result.scalar_one_or_none()
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")

    # 统计各状态订单数
    stats_query = (
        select(models.PurchaseOrder.status, func.count(models.PurchaseOrder.id))
        .where(models.PurchaseOrder.supplier_name == supplier.name)
        .group_by(models.PurchaseOrder.status)
    )

    stats_result = await db.execute(stats_query)
    status_counts = {status: count for status, count in stats_result.all()}

    # 获取未齐套的订单,检查缺少的文档
    incomplete_docs = []
    incomplete_orders_query = (
        select(models.PurchaseOrder)
        .where(
            and_(
                models.PurchaseOrder.supplier_name == supplier.name,
                models.PurchaseOrder.status == models.OrderStatus.PENDING_UPLOAD,
            )
        )
        .options(selectinload(models.PurchaseOrder.documents))
    )

    incomplete_result = await db.execute(incomplete_orders_query)
    incomplete_orders = incomplete_result.scalars().all()

    missing_doc_types = set()
    for order in incomplete_orders:
        for doc in order.documents:
            if not doc.file_name:
                missing_doc_types.add(doc.doc_type.value)

    incomplete_docs = list(missing_doc_types)

    # 查找同类别的其他供应商
    similar_query = (
        select(models.Supplier)
        .where(
            and_(
                models.Supplier.category.overlap(supplier.category),
                models.Supplier.id != supplier.id,
                models.Supplier.is_active == True,
            )
        )
        .options(selectinload(models.Supplier.contacts))
        .limit(5)
    )

    similar_result = await db.execute(similar_query)
    similar_suppliers_raw = similar_result.scalars().all()

    similar_suppliers = [
        schemas.SupplierResponse(
            id=s.id,
            name=s.name,
            code=s.code,
            category=s.category,
            address=s.address,
            website=s.website,
            business_license=s.business_license,
            notes=s.notes,
            is_active=s.is_active,
            is_new=s.is_new,
            is_site_inspected=s.is_site_inspected,
            created_at=s.created_at,
            updated_at=s.updated_at,
            has_account=False,
            total_orders=0,
            pending_orders=0,
            incomplete_orders=0,
            contacts=[
                schemas.SupplierContactResponse.model_validate(c) for c in s.contacts
            ],
        )
        for s in similar_suppliers_raw
    ]

    total_orders = sum(status_counts.values())

    return schemas.SupplierDetailStats(
        supplier_id=supplier.id,
        supplier_name=supplier.name,
        total_orders=total_orders,
        pending_upload=status_counts.get(models.OrderStatus.PENDING_UPLOAD, 0),
        ready_for_review=status_counts.get(models.OrderStatus.READY_FOR_REVIEW, 0),
        approved=status_counts.get(models.OrderStatus.APPROVED, 0),
        rejected=status_counts.get(models.OrderStatus.REJECTED, 0),
        received=status_counts.get(models.OrderStatus.RECEIVED, 0),
        incomplete_docs=incomplete_docs,
        similar_suppliers=similar_suppliers,
    )


@router.put("/{supplier_id}", response_model=schemas.SupplierResponse)
async def update_supplier(
    supplier_id: int,
    supplier_data: schemas.SupplierUpdate,
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """更新供应商信息 (仅管理员)"""
    ensure_super_admin(current_user, "Only super admins can update suppliers")

    # 获取供应商
    result = await db.execute(
        select(models.Supplier)
        .where(models.Supplier.id == supplier_id)
        .options(selectinload(models.Supplier.contacts))
    )
    supplier = result.scalar_one_or_none()
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")

    # 更新字段
    update_data = supplier_data.model_dump(exclude_unset=True)

    # 检查名称唯一性
    if "name" in update_data and update_data["name"] != supplier.name:
        result = await db.execute(
            select(models.Supplier).where(models.Supplier.name == update_data["name"])
        )
        if result.scalar_one_or_none():
            raise HTTPException(status_code=400, detail="Supplier name already exists")

    # 检查编码唯一性
    if "code" in update_data and update_data["code"] != supplier.code:
        result = await db.execute(
            select(models.Supplier).where(models.Supplier.code == update_data["code"])
        )
        if result.scalar_one_or_none():
            raise HTTPException(status_code=400, detail="Supplier code already exists")

    old_name = supplier.name

    # 处理联系人更新
    if "contacts" in update_data:
        contacts_data = update_data.pop("contacts")
        # 清空现有联系人 (依靠 cascade="all, delete-orphan")
        supplier.contacts = []

        # 添加新联系人
        for contact_info in contacts_data:
            new_contact = models.SupplierContact(
                name=contact_info["name"],
                position=contact_info.get("position"),
                phone=contact_info.get("phone"),
                email=contact_info.get("email"),
                is_primary=contact_info.get("is_primary", False),
            )
            supplier.contacts.append(new_contact)

    for key, value in update_data.items():
        setattr(supplier, key, value)

    await db.commit()
    await db.refresh(supplier)

    # 如果名称改变,更新相关的User和PurchaseOrder
    if "name" in update_data and update_data["name"] != old_name:
        # 更新用户的supplier_name
        await db.execute(
            models.User.__table__.update()
            .where(models.User.supplier_name == old_name)
            .values(supplier_name=supplier.name)
        )

        # 更新订单的supplier_name
        await db.execute(
            models.PurchaseOrder.__table__.update()
            .where(models.PurchaseOrder.supplier_name == old_name)
            .values(supplier_name=supplier.name)
        )

        await db.commit()

    # 获取统计信息
    user_result = await db.execute(
        select(models.User).where(models.User.supplier_name == supplier.name)
    )
    has_account = user_result.scalar_one_or_none() is not None

    orders_result = await db.execute(
        select(func.count(models.PurchaseOrder.id)).where(
            models.PurchaseOrder.supplier_name == supplier.name
        )
    )
    total_orders = orders_result.scalar() or 0

    return schemas.SupplierResponse(
        id=supplier.id,
        name=supplier.name,
        code=supplier.code,
        category=supplier.category,
        address=supplier.address,
        office_phone=supplier.office_phone,
        fax=supplier.fax,
        website=supplier.website,
        business_license=supplier.business_license,
        notes=supplier.notes,
        is_active=supplier.is_active,
        is_new=supplier.is_new,
        is_site_inspected=supplier.is_site_inspected,
        created_at=supplier.created_at,
        updated_at=supplier.updated_at,
        has_account=has_account,
        total_orders=total_orders,
        pending_orders=0,
        incomplete_orders=0,
        contacts=[
            schemas.SupplierContactResponse.model_validate(c) for c in supplier.contacts
        ],
    )


@router.post("/{supplier_id}/account", response_model=dict)
async def generate_supplier_account(
    supplier_id: int,
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """为供应商生成或重置账户 (仅管理员)"""
    ensure_super_admin(current_user, "Only super admins can manage supplier accounts")

    # 获取供应商
    result = await db.execute(
        select(models.Supplier).where(models.Supplier.id == supplier_id)
    )
    supplier = result.scalar_one_or_none()
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")

    # 查找关联账户
    result = await db.execute(
        select(models.User).where(models.User.supplier_name == supplier.name)
    )
    user = result.scalar_one_or_none()

    password = generate_password()
    hashed_password = get_password_hash(password)

    if user:
        # 重置密码
        user.hashed_password = hashed_password
        user.plain_password = password
        message = "Account password reset successfully"
        username = user.username
    else:
        # 创建新账户
        username = f"supplier_{supplier.id}"

        # 检查用户名是否存在
        result = await db.execute(
            select(models.User).where(models.User.username == username)
        )
        if result.scalar_one_or_none():
            # 如果存在，尝试添加随机后缀
            username = f"supplier_{supplier.id}_{secrets.token_hex(2)}"

        new_user = models.User(
            username=username,
            hashed_password=hashed_password,
            plain_password=password,
            role=models.UserRole.SUPPLIER,
            is_super_admin=False,
            supplier_name=supplier.name,
            is_active=True,
        )
        db.add(new_user)
        message = "Account created successfully"

    await db.commit()

    return {
        "success": True,
        "message": message,
        "username": username,
        "password": password,
    }


@router.post("/batch/delete")
async def batch_soft_delete(
    request: schemas.SupplierBatchRequest,
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """批量软删除供应商"""
    ensure_super_admin(current_user, "Only super admins can delete suppliers")

    if not request.ids:
        return {"message": "No IDs provided"}

    # Update suppliers
    await db.execute(
        models.Supplier.__table__.update()
        .where(models.Supplier.id.in_(request.ids))
        .values(is_deleted=True, deleted_at=func.now())
    )

    # Deactivate associated users
    # Need to fetch supplier names to deactivate users
    result = await db.execute(
        select(models.Supplier.name).where(models.Supplier.id.in_(request.ids))
    )
    supplier_names = result.scalars().all()

    if supplier_names:
        await db.execute(
            models.User.__table__.update()
            .where(models.User.supplier_name.in_(supplier_names))
            .values(is_active=False)
        )

    await db.commit()
    return {"message": f"Successfully deleted {len(request.ids)} suppliers"}


@router.post("/batch/restore")
async def batch_restore(
    request: schemas.SupplierBatchRequest,
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """批量恢复供应商"""
    ensure_super_admin(current_user, "Only super admins can restore suppliers")

    if not request.ids:
        return {"message": "No IDs provided"}

    # Update suppliers
    await db.execute(
        models.Supplier.__table__.update()
        .where(models.Supplier.id.in_(request.ids))
        .values(is_deleted=False, deleted_at=None)
    )

    # Reactivate associated users
    result = await db.execute(
        select(models.Supplier.name).where(models.Supplier.id.in_(request.ids))
    )
    supplier_names = result.scalars().all()

    if supplier_names:
        await db.execute(
            models.User.__table__.update()
            .where(models.User.supplier_name.in_(supplier_names))
            .values(is_active=True)
        )

    await db.commit()
    return {"message": f"Successfully restored {len(request.ids)} suppliers"}


@router.delete("/batch/permanent")
async def batch_permanent_delete(
    request: schemas.SupplierBatchRequest,
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """批量永久删除供应商"""
    ensure_super_admin(current_user, "Only super admins can delete suppliers")

    if not request.ids:
        return {"message": "No IDs provided"}

    # This is complex because of file deletions. Iterating is safer.
    # To optimize, we could fetch all data in bulk, but file deletion is per-file anyway.

    # Fetch all suppliers to be deleted
    result = await db.execute(
        select(models.Supplier)
        .options(selectinload(models.Supplier.documents))
        .where(models.Supplier.id.in_(request.ids))
    )
    suppliers = result.scalars().all()

    for supplier in suppliers:
        # 1. Delete files (Supplier Level)
        for doc in supplier.documents:
            if doc.file_path:
                minio_client.delete_file(doc.file_path)

        # 2. Delete PO files & POs
        po_result = await db.execute(
            select(models.PurchaseOrder)
            .options(selectinload(models.PurchaseOrder.documents))
            .where(models.PurchaseOrder.supplier_name == supplier.name)
        )
        pos = po_result.scalars().all()
        for po in pos:
            for doc in po.documents:
                if doc.file_path:
                    minio_client.delete_file(doc.file_path)
            await db.delete(po)

        # Flush PO deletes before User delete
        await db.flush()

        # 3. Delete Users
        await db.execute(
            models.User.__table__.delete().where(
                models.User.supplier_name == supplier.name
            )
        )

        # 4. Delete Supplier
        await db.delete(supplier)

    await db.commit()
    return {"message": f"Successfully permanently deleted {len(suppliers)} suppliers"}


@router.get("/recycle/bin", response_model=List[schemas.SupplierResponse])
async def get_recycle_bin(
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """获取回收站中的供应商列表 (仅管理员)"""
    ensure_super_admin(current_user, "Only super admins can access recycle bin")

    query = (
        select(models.Supplier)
        .options(
            selectinload(models.Supplier.contacts),
            selectinload(models.Supplier.documents),
        )
        .where(models.Supplier.is_deleted == True)
        .order_by(models.Supplier.deleted_at.desc())
    )

    result = await db.execute(query)
    suppliers = result.scalars().all()

    # Map to response (reusing complex fields if needed, simple here)
    response = []
    for s in suppliers:
        # We need to construct SupplierResponse manually if pydantic from_orm isn't auto-handling everything perfectly
        # or just rely on Config.from_attributes.
        # But `SupplierResponse` has computed fields like `has_account`, `total_orders` etc.
        # For Recycle Bin, we can keep it simple or fill basic info.

        # Let's try basic Pydantic conversion, but we need to ensure computed fields don't crash.
        # Ideally we refactor `list_suppliers` logic into a helper, but for now duplicate the mapping logic for safety
        # Or simplify for recycle bin.

        primary_contact = next(
            (c for c in s.contacts if c.is_primary),
            s.contacts[0] if s.contacts else None,
        )

        response.append(
            schemas.SupplierResponse(
                id=s.id,
                name=s.name,
                code=s.code,
                category=s.category,
                is_active=s.is_active,
                is_site_inspected=s.is_site_inspected,
                contact_name=primary_contact.name if primary_contact else None,
                contact_phone=primary_contact.phone if primary_contact else None,
                is_deleted=s.is_deleted,
                deleted_at=s.deleted_at,
                created_at=s.created_at,
                updated_at=s.updated_at,
                address=s.address,
                office_phone=s.office_phone,
                fax=s.fax,
                website=s.website,
                business_license=s.business_license,
                notes=s.notes,
                contacts=[
                    schemas.SupplierContactResponse.model_validate(c)
                    for c in s.contacts
                ],
                documents=[],  # Simplify docs for list view
            )
        )

    return response


@router.delete("/{supplier_id}", status_code=status.HTTP_204_NO_CONTENT)
async def soft_delete_supplier(
    supplier_id: int,
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """软删除供应商 (移入回收站)"""
    ensure_super_admin(current_user, "Only super admins can delete suppliers")

    result = await db.execute(
        select(models.Supplier).where(models.Supplier.id == supplier_id)
    )
    supplier = result.scalar_one_or_none()

    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")

    # Explicitly update to ensure fields are set
    await db.execute(
        models.Supplier.__table__.update()
        .where(models.Supplier.id == supplier_id)
        .values(is_deleted=True, deleted_at=func.now())
    )

    # Deactivate associated users
    await db.execute(
        models.User.__table__.update()
        .where(models.User.supplier_name == supplier.name)
        .values(is_active=False)
    )

    await db.commit()


@router.post("/{supplier_id}/restore")
async def restore_supplier(
    supplier_id: int,
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """从回收站恢复供应商"""
    ensure_super_admin(current_user, "Only super admins can restore suppliers")

    result = await db.execute(
        select(models.Supplier).where(models.Supplier.id == supplier_id)
    )
    supplier = result.scalar_one_or_none()

    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")

    supplier.is_deleted = False
    supplier.deleted_at = None

    # Reactivate users
    user_result = await db.execute(
        select(models.User).where(models.User.supplier_name == supplier.name)
    )
    users = user_result.scalars().all()
    for user in users:
        user.is_active = True

    await db.commit()
    return {"message": "Supplier restored successfully"}


@router.delete("/{supplier_id}/permanent", status_code=status.HTTP_204_NO_CONTENT)
async def permanent_delete_supplier(
    supplier_id: int,
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """永久删除供应商 (不可恢复)"""
    ensure_super_admin(
        current_user,
        "Only super admins can permanently delete suppliers",
    )

    # Fetch supplier with relations
    result = await db.execute(
        select(models.Supplier)
        .options(selectinload(models.Supplier.documents))
        .where(models.Supplier.id == supplier_id)
    )
    supplier = result.scalar_one_or_none()

    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")

    # 1. Delete files from MinIO (Supplier Level)
    for doc in supplier.documents:
        if doc.file_path:
            minio_client.delete_file(doc.file_path)

    # Order Level Docs and POs
    po_result = await db.execute(
        select(models.PurchaseOrder)
        .options(selectinload(models.PurchaseOrder.documents))
        .where(models.PurchaseOrder.supplier_name == supplier.name)
    )
    pos = po_result.scalars().all()
    for po in pos:
        for doc in po.documents:
            if doc.file_path:
                minio_client.delete_file(doc.file_path)
        await db.delete(po)

    # Ensure POs are deleted before removing users to satisfy foreign keys
    await db.flush()

    # 2. Delete Users
    await db.execute(
        models.User.__table__.delete().where(models.User.supplier_name == supplier.name)
    )

    # 3. Delete Supplier
    await db.delete(supplier)
    await db.commit()
