from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, desc, func
from sqlalchemy.orm import selectinload
from typing import List
from datetime import datetime
from pathlib import Path
import models
import schemas
from database import get_db
from routers.auth import get_current_user
from storage import minio_client

router = APIRouter(prefix="/api/orders", tags=["Orders"])


def check_all_documents_uploaded(order: models.PurchaseOrder) -> bool:
    """Check if all required documents are uploaded"""
    required_types = [
        models.DocType.MSDS,
        models.DocType.ROHS,
        # models.DocType.REACH, # Moved to Supplier Level
        models.DocType.SPEC,
        models.DocType.REPORT,
        models.DocType.OTHER,
    ]
    for doc_type in required_types:
        doc = next((d for d in order.documents if d.doc_type == doc_type), None)
        if not doc or not doc.file_name:
            return False
    return True


async def get_supplier_reach_document(
    order: models.PurchaseOrder, db: AsyncSession
) -> models.SupplierDocument | None:
    result = await db.execute(
        select(models.SupplierDocument)
        .join(models.Supplier, models.SupplierDocument.supplier_id == models.Supplier.id)
        .where(
            and_(
                models.Supplier.name == order.supplier_name,
                func.upper(models.SupplierDocument.doc_type).like("%REACH%"),
                models.SupplierDocument.file_name.is_not(None),
                models.SupplierDocument.file_path.is_not(None),
            )
        )
        .order_by(desc(models.SupplierDocument.uploaded_at))
        .limit(1)
    )
    return result.scalar_one_or_none()


async def convert_order_to_response(
    order: models.PurchaseOrder, db: AsyncSession
) -> dict:
    """Convert SQLAlchemy order model to response format"""
    supplier_reach_doc = await get_supplier_reach_document(order, db)

    # Build documents dict
    docs_dict = {}
    for doc_type in models.DocType:
        if doc_type == models.DocType.REACH and supplier_reach_doc:
            doc = supplier_reach_doc
            response_doc_type = models.DocType.REACH
        else:
            doc = next((d for d in order.documents if d.doc_type == doc_type), None)
            response_doc_type = doc_type

        if doc and doc.file_name and doc.file_path:
            # Verify file exists in MinIO before generating URL
            try:
                file_exists = minio_client.file_exists(doc.file_path)
                if file_exists:
                    url = minio_client.get_presigned_url(doc.file_path)
                    download_url = minio_client.get_presigned_download_url(
                        doc.file_path, doc.file_name
                    )
                    docs_dict[doc_type] = schemas.DocumentFile(
                        type=response_doc_type,
                        fileName=doc.file_name,
                        uploadedAt=doc.uploaded_at,
                        url=url,
                        downloadUrl=download_url,
                    )
                else:
                    # File deleted from MinIO but DB record exists
                    docs_dict[doc_type] = schemas.DocumentFile(
                        type=response_doc_type,
                        fileName=None,
                        uploadedAt=None,
                        url=None,
                        downloadUrl=None,
                    )
            except Exception:
                # Error checking file, treat as not found
                docs_dict[doc_type] = schemas.DocumentFile(
                    type=response_doc_type,
                    fileName=None,
                    uploadedAt=None,
                    url=None,
                    downloadUrl=None,
                )
        else:
            docs_dict[doc_type] = schemas.DocumentFile(
                type=response_doc_type,
                fileName=None,
                uploadedAt=None,
                url=None,
                downloadUrl=None,
            )

    # Build logs list
    logs_list = [
        schemas.LogEntry(
            timestamp=log.timestamp,
            action=log.action,
            actor=log.actor,
            details=log.details,
        )
        for log in order.logs
    ]

    return {
        "id": order.id,
        "partNumber": order.part_number,
        "partName": order.part_name,
        "supplierName": order.supplier_name,
        "status": order.status,
        "documents": docs_dict,
        "logs": logs_list,
        "rejectReason": order.reject_reason,
    }


@router.get("/", response_model=List[schemas.PurchaseOrderResponse])
async def get_orders(
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get all orders (filtered by role)"""
    query = select(models.PurchaseOrder).options(
        selectinload(models.PurchaseOrder.documents),
        selectinload(models.PurchaseOrder.logs),
    )

    # Filter by supplier for SUPPLIER role
    if current_user.role == models.UserRole.SUPPLIER:
        query = query.where(
            models.PurchaseOrder.supplier_name == current_user.supplier_name
        )

    result = await db.execute(query)
    orders = result.scalars().all()

    return [await convert_order_to_response(order, db) for order in orders]


@router.get("/{order_id}", response_model=schemas.PurchaseOrderResponse)
async def get_order(
    order_id: str,
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get specific order by ID"""
    result = await db.execute(
        select(models.PurchaseOrder)
        .where(models.PurchaseOrder.id == order_id)
        .options(
            selectinload(models.PurchaseOrder.documents),
            selectinload(models.PurchaseOrder.logs),
        )
    )
    order = result.scalar_one_or_none()

    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    # Check permission for SUPPLIER role
    if (
        current_user.role == models.UserRole.SUPPLIER
        and order.supplier_name != current_user.supplier_name
    ):
        raise HTTPException(status_code=403, detail="Not authorized to view this order")

    return await convert_order_to_response(order, db)


@router.post(
    "/",
    response_model=schemas.PurchaseOrderResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_order(
    order_data: schemas.PurchaseOrderCreate,
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create a new purchase order (SUPPLIER only)"""
    if current_user.role != models.UserRole.SUPPLIER:
        raise HTTPException(status_code=403, detail="Only suppliers can create orders")

    # Check if order ID already exists
    result = await db.execute(
        select(models.PurchaseOrder).where(models.PurchaseOrder.id == order_data.id)
    )
    if result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Order ID already exists")

    # Verify supplier name matches current user
    if order_data.supplierName != current_user.supplier_name:
        raise HTTPException(status_code=403, detail="Supplier name mismatch")

    # Create order
    new_order = models.PurchaseOrder(
        id=order_data.id,
        part_number=order_data.partNumber,
        part_name=order_data.partName,
        supplier_name=order_data.supplierName,
        status=models.OrderStatus.PENDING_UPLOAD,
        created_by=current_user.id,
    )
    db.add(new_order)

    # Create empty document placeholders
    for doc_type in models.DocType:
        doc = models.Document(order_id=new_order.id, doc_type=doc_type)
        db.add(doc)

    # Create log entry
    log = models.OrderLog(
        order_id=new_order.id,
        action="创建交料任务",
        actor=models.UserRole.SUPPLIER.value,
        details="供应商自助创建",
    )
    db.add(log)

    await db.commit()
    await db.refresh(new_order)

    # Reload with relationships
    result = await db.execute(
        select(models.PurchaseOrder)
        .where(models.PurchaseOrder.id == new_order.id)
        .options(
            selectinload(models.PurchaseOrder.documents),
            selectinload(models.PurchaseOrder.logs),
        )
    )
    order = result.scalar_one()

    return await convert_order_to_response(order, db)


@router.post("/{order_id}/upload/{doc_type}", response_model=schemas.FileUploadResponse)
async def upload_document(
    order_id: str,
    doc_type: str,  # Accept as string, convert to enum manually
    file: UploadFile = File(...),
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Upload a document for an order (SUPPLIER only)"""
    # Convert string to DocType enum
    try:
        doc_type_enum = models.DocType[doc_type]  # e.g., "SPEC" -> DocType.SPEC
    except KeyError:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid document type. Must be one of: {', '.join([dt.name for dt in models.DocType])}",
        )

    if current_user.role != models.UserRole.SUPPLIER:
        raise HTTPException(
            status_code=403, detail="Only suppliers can upload documents"
        )

    # Get order
    result = await db.execute(
        select(models.PurchaseOrder)
        .where(models.PurchaseOrder.id == order_id)
        .options(selectinload(models.PurchaseOrder.documents))
    )
    order = result.scalar_one_or_none()

    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    if order.supplier_name != current_user.supplier_name:
        raise HTTPException(
            status_code=403, detail="Not authorized to upload to this order"
        )

    # Check if order is locked
    if order.status in [
        models.OrderStatus.READY_FOR_REVIEW,
        models.OrderStatus.APPROVED,
        models.OrderStatus.RECEIVED,
    ]:
        raise HTTPException(status_code=400, detail="Cannot upload to locked order")

    # Validate file type
    allowed_extensions = {
        ".pdf",
        ".zip",
        ".rar",
        ".7z",
        ".tar",
        ".gz",
        ".tar.gz",
        ".tgz",
    }
    allowed_mime_types = {
        "application/pdf",
        "application/zip",
        "application/x-zip-compressed",
        "application/x-rar-compressed",
        "application/x-7z-compressed",
        "application/x-tar",
        "application/gzip",
        "application/x-gzip",
    }

    file_ext = "".join(Path(file.filename).suffixes).lower()
    if (
        file_ext not in allowed_extensions
        and file.content_type not in allowed_mime_types
    ):
        raise HTTPException(
            status_code=400,
            detail=f"不支持的文件类型。允许的格式: PDF, ZIP, RAR, 7Z, TAR, GZ",
        )

    # Read file content
    file_content = await file.read()

    # Validate file size (50MB limit)
    max_size = 50 * 1024 * 1024
    if len(file_content) > max_size:
        raise HTTPException(status_code=400, detail="文件过大，最大支持 50MB")

    # Generate object path in MinIO
    file_path = f"{order_id}/{doc_type_enum.value}/{file.filename}"

    # Upload to MinIO
    success = minio_client.upload_file(
        file_content, file_path, file.content_type or "application/octet-stream"
    )
    if not success:
        raise HTTPException(status_code=500, detail="Failed to upload file")

    # Update document record
    doc = next((d for d in order.documents if d.doc_type == doc_type_enum), None)
    if doc:
        # Delete old file if exists and path is different
        if doc.file_path and doc.file_path != file_path:
            minio_client.delete_file(doc.file_path)

        doc.file_name = file.filename
        doc.file_path = file_path
        doc.uploaded_at = datetime.utcnow()
        doc.uploaded_by = current_user.id

    # Reset status if rejected
    if order.status == models.OrderStatus.REJECTED:
        order.status = models.OrderStatus.PENDING_UPLOAD
        order.reject_reason = None

    # Add log entry
    log = models.OrderLog(
        order_id=order_id,
        action=f"上传文件: {doc_type_enum.value}",
        actor=models.UserRole.SUPPLIER.value,
        details=file.filename,
    )
    db.add(log)

    await db.commit()
    await db.refresh(doc)

    # Generate presigned URLs
    url = minio_client.get_presigned_url(file_path)
    download_url = minio_client.get_presigned_download_url(file_path, doc.file_name)

    return {
        "success": True,
        "message": "File uploaded successfully",
        "document": schemas.DocumentFile(
            type=doc_type_enum,
            fileName=doc.file_name,
            uploadedAt=doc.uploaded_at,
            url=url,
            downloadUrl=download_url,
        ),
    }


@router.delete("/{order_id}/upload/{doc_type}")
async def delete_document(
    order_id: str,
    doc_type: str,  # Accept as string, convert to enum manually
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a document from an order (SUPPLIER only)"""
    # Convert string to DocType enum
    try:
        doc_type_enum = models.DocType[doc_type]
    except KeyError:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid document type. Must be one of: {', '.join([dt.name for dt in models.DocType])}",
        )

    if current_user.role != models.UserRole.SUPPLIER:
        raise HTTPException(
            status_code=403, detail="Only suppliers can delete documents"
        )

    # Get order
    result = await db.execute(
        select(models.PurchaseOrder)
        .where(models.PurchaseOrder.id == order_id)
        .options(selectinload(models.PurchaseOrder.documents))
    )
    order = result.scalar_one_or_none()

    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    if order.supplier_name != current_user.supplier_name:
        raise HTTPException(
            status_code=403, detail="Not authorized to delete from this order"
        )

    # Check if order is locked
    if order.status in [
        models.OrderStatus.READY_FOR_REVIEW,
        models.OrderStatus.APPROVED,
        models.OrderStatus.RECEIVED,
    ]:
        raise HTTPException(status_code=400, detail="Cannot delete from locked order")

    # Get document record
    doc = next((d for d in order.documents if d.doc_type == doc_type_enum), None)
    if not doc or not doc.file_name:
        raise HTTPException(status_code=404, detail="Document not found")

    # Store filename for log before deletion
    deleted_filename = doc.file_name

    # Delete file from MinIO
    if doc.file_path:
        minio_client.delete_file(doc.file_path)

    # Clear document record
    doc.file_name = None
    doc.file_path = None
    doc.uploaded_at = None
    doc.uploaded_by = None

    # Add log entry
    log = models.OrderLog(
        order_id=order_id,
        action=f"删除文件: {doc_type_enum.value}",
        actor=models.UserRole.SUPPLIER.value,
        details=deleted_filename,
    )
    db.add(log)

    await db.commit()

    return {"success": True, "message": "File deleted successfully"}


@router.get("/{order_id}/view/{doc_type}")
async def view_document(
    order_id: str,
    doc_type: str,
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get presigned URL for viewing a document (ADMIN, IQC, or owner SUPPLIER)"""
    # Convert string to DocType enum
    try:
        doc_type_enum = models.DocType[doc_type]
    except KeyError:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid document type. Must be one of: {', '.join([dt.name for dt in models.DocType])}",
        )

    # Get order
    result = await db.execute(
        select(models.PurchaseOrder)
        .where(models.PurchaseOrder.id == order_id)
        .options(selectinload(models.PurchaseOrder.documents))
    )
    order = result.scalar_one_or_none()

    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    # Check authorization
    if current_user.role == models.UserRole.SUPPLIER:
        if order.supplier_name != current_user.supplier_name:
            raise HTTPException(
                status_code=403, detail="Not authorized to view this order"
            )

    # Get document
    doc = next((d for d in order.documents if d.doc_type == doc_type_enum), None)
    if not doc or not doc.file_path:
        raise HTTPException(status_code=404, detail="Document not found")

    # Generate presigned URL for viewing
    url = minio_client.get_presigned_url(doc.file_path, response_disposition="inline")
    if not url:
        raise HTTPException(status_code=500, detail="Failed to generate view URL")

    return {"url": url}


@router.get("/{order_id}/download/{doc_type}")
async def download_document(
    order_id: str,
    doc_type: str,
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get presigned URL for downloading a document (ADMIN, IQC, or owner SUPPLIER)"""
    # Convert string to DocType enum
    try:
        doc_type_enum = models.DocType[doc_type]
    except KeyError:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid document type. Must be one of: {', '.join([dt.name for dt in models.DocType])}",
        )

    # Get order
    result = await db.execute(
        select(models.PurchaseOrder)
        .where(models.PurchaseOrder.id == order_id)
        .options(selectinload(models.PurchaseOrder.documents))
    )
    order = result.scalar_one_or_none()

    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    # Check authorization
    if current_user.role == models.UserRole.SUPPLIER:
        if order.supplier_name != current_user.supplier_name:
            raise HTTPException(
                status_code=403, detail="Not authorized to download from this order"
            )

    # Get document
    doc = next((d for d in order.documents if d.doc_type == doc_type_enum), None)
    if not doc or not doc.file_path:
        raise HTTPException(status_code=404, detail="Document not found")

    # Generate presigned URL for download
    download_url = minio_client.get_presigned_download_url(doc.file_path, doc.file_name)
    if not download_url:
        raise HTTPException(status_code=500, detail="Failed to generate download URL")

    return {"url": download_url}


@router.post("/{order_id}/submit")
async def submit_for_review(
    order_id: str,
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Submit order for review when all documents are uploaded (SUPPLIER only)"""
    if current_user.role != models.UserRole.SUPPLIER:
        raise HTTPException(status_code=403, detail="Only suppliers can submit orders")

    # Get order
    result = await db.execute(
        select(models.PurchaseOrder)
        .where(models.PurchaseOrder.id == order_id)
        .options(selectinload(models.PurchaseOrder.documents))
    )
    order = result.scalar_one_or_none()

    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    if order.supplier_name != current_user.supplier_name:
        raise HTTPException(status_code=403, detail="Not authorized")

    # Check if all documents uploaded (Order level)
    if not check_all_documents_uploaded(order):
        raise HTTPException(
            status_code=400,
            detail="Missing required order documents (MSDS, RoHS, Spec, Report)",
        )

    # Check if Supplier has REACH (Supplier level)
    # Find supplier by name
    supplier_result = await db.execute(
        select(models.Supplier).where(models.Supplier.name == order.supplier_name)
    )
    supplier = supplier_result.scalar_one_or_none()
    if not supplier:
        raise HTTPException(status_code=400, detail="Supplier not found")

    reach_result = await db.execute(
        select(models.SupplierDocument).where(
            and_(
                models.SupplierDocument.supplier_id == supplier.id,
                models.SupplierDocument.doc_type == "REACH",
            )
        )
    )
    if not reach_result.scalar_one_or_none():
        raise HTTPException(
            status_code=400,
            detail="Missing Supplier REACH document. Please upload in Enterprise Qualification.",
        )

    # Update status
    order.status = models.OrderStatus.READY_FOR_REVIEW

    # Add log entry
    log = models.OrderLog(
        order_id=order_id,
        action="资料齐套,提交审核",
        actor=models.UserRole.SUPPLIER.value,
    )
    db.add(log)

    await db.commit()

    return {"success": True, "message": "Order submitted for review"}


@router.post("/{order_id}/approve")
async def approve_order(
    order_id: str,
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Approve an order (ADMIN only)"""
    if current_user.role != models.UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="Only admins can approve orders")

    # Get order
    result = await db.execute(
        select(models.PurchaseOrder).where(models.PurchaseOrder.id == order_id)
    )
    order = result.scalar_one_or_none()

    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    if order.status != models.OrderStatus.READY_FOR_REVIEW:
        raise HTTPException(
            status_code=400, detail="Only orders ready for review can be approved"
        )

    # Update status
    order.status = models.OrderStatus.APPROVED
    order.reject_reason = None

    # Add log entry
    log = models.OrderLog(
        order_id=order_id,
        action="审核通过",
        actor=f"{current_user.username} (Admin)",
        details="资料符合要求",
    )
    db.add(log)

    await db.commit()

    return {"success": True, "message": "Order approved"}


@router.post("/{order_id}/reject")
async def reject_order(
    order_id: str,
    reason: str = Form(...),
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Reject an order (ADMIN only)"""
    if current_user.role != models.UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="Only admins can reject orders")

    if not reason.strip():
        raise HTTPException(status_code=400, detail="Reject reason is required")

    # Get order
    result = await db.execute(
        select(models.PurchaseOrder).where(models.PurchaseOrder.id == order_id)
    )
    order = result.scalar_one_or_none()

    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    # Update status
    order.status = models.OrderStatus.REJECTED
    order.reject_reason = reason

    # Add log entry
    log = models.OrderLog(
        order_id=order_id,
        action="审核驳回",
        actor=f"{current_user.username} (Admin)",
        details=reason,
    )
    db.add(log)

    await db.commit()

    return {"success": True, "message": "Order rejected"}


@router.post("/{order_id}/receive")
async def receive_order(
    order_id: str,
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Confirm receipt of physical goods (IQC only)"""
    if current_user.role != models.UserRole.IQC:
        raise HTTPException(status_code=403, detail="Only IQC can receive orders")

    # Get order
    result = await db.execute(
        select(models.PurchaseOrder).where(models.PurchaseOrder.id == order_id)
    )
    order = result.scalar_one_or_none()

    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    if order.status != models.OrderStatus.APPROVED:
        raise HTTPException(
            status_code=400,
            detail="Can only receive orders that have been approved. Current status: "
            + order.status.value,
        )

    # Update status
    order.status = models.OrderStatus.RECEIVED

    # Add log entry
    log = models.OrderLog(
        order_id=order_id,
        action="实物收货确认",
        actor=f"{current_user.username} (IQC)",
        details="资料状态符合,允许收货",
    )
    db.add(log)

    await db.commit()

    return {"success": True, "message": "Order received"}

@router.get("/history/documents", response_model=List[schemas.DocumentHistoryResponse])
async def get_document_history(
    doc_type: str = Query(..., description="The document type to filter by"),
    limit: int = 10,
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Get previously uploaded documents of a specific type for the current supplier.
    Used for 'Reuse Document' feature.
    """
    if current_user.role != models.UserRole.SUPPLIER:
        raise HTTPException(status_code=403, detail="Only suppliers can access history")

    # Determine supplier identifier (username or supplier_name based on legacy logic)
    supplier_identifier = current_user.supplier_name or current_user.username

    # Query documents joined with purchase orders
    stmt = (
        select(models.Document, models.PurchaseOrder)
        .join(models.PurchaseOrder, models.Document.order_id == models.PurchaseOrder.id)
        .where(
            and_(
                models.PurchaseOrder.supplier_name == supplier_identifier,
                models.Document.doc_type == doc_type,
                models.Document.file_name.isnot(None),  # Must have a file
                models.Document.file_path.isnot(None),  # Must have a path
            )
        )
        .order_by(desc(models.Document.uploaded_at))
        .limit(limit)
    )

    result = await db.execute(stmt)
    rows = result.all()

    history = []
    for doc, order in rows:
        history.append(
            schemas.DocumentHistoryResponse(
                id=doc.id,
                fileName=doc.file_name,
                uploadedAt=doc.uploaded_at,
                partNumber=order.part_number,
                orderId=order.id,
            )
        )

    return history


@router.post("/{order_id}/documents/reuse")
async def reuse_document(
    order_id: str,
    request: schemas.ReuseDocumentRequest,
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Reuse an existing document for the current order.
    Copies the file in object storage to ensure isolation.
    """
    if current_user.role != models.UserRole.SUPPLIER:
        raise HTTPException(status_code=403, detail="Only suppliers can perform this action")

    # 1. Get current order
    stmt = select(models.PurchaseOrder).where(models.PurchaseOrder.id == order_id)
    result = await db.execute(stmt)
    order = result.scalar_one_or_none()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    # Verify order ownership
    supplier_identifier = current_user.supplier_name or current_user.username
    if order.supplier_name != supplier_identifier:
        raise HTTPException(status_code=403, detail="Permission denied")

    # 2. Get source document
    source_doc_stmt = (
        select(models.Document, models.PurchaseOrder)
        .join(models.PurchaseOrder, models.Document.order_id == models.PurchaseOrder.id)
        .where(models.Document.id == request.sourceDocId)
    )
    result = await db.execute(source_doc_stmt)
    source_row = result.first()
    
    if not source_row:
        raise HTTPException(status_code=404, detail="Source document not found")
        
    source_doc, source_order = source_row

    # Verify source document ownership (must belong to same supplier)
    if source_order.supplier_name != supplier_identifier:
        raise HTTPException(status_code=403, detail="Permission denied: Cannot reuse other supplier's document")
    
    # 3. Handle file copy in MinIO
    # Construct new file path: {order_id}/{doc_type}/{source_filename}
    new_file_path = f"{order_id}/{request.docType}/{source_doc.file_name}"
    
    # Check if a file already exists at destination (overwrite or error?)
    # Logic: Upload endpoint overwrites, so we should too.
    
    try:
        # Check source exists
        if not minio_client.file_exists(source_doc.file_path):
             raise HTTPException(status_code=404, detail="Source file missing from storage")

        # Skip copy if source and dest are the same
        if source_doc.file_path != new_file_path:
            # Copy object
            success = minio_client.copy_object(source_doc.file_path, new_file_path)
            if not success:
                 raise HTTPException(status_code=500, detail="Failed to copy file in storage")

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Storage error: {str(e)}")

    # 4. Update or Create Document Record for Target
    # Check if doc record already exists for this type in target order
    doc_stmt = select(models.Document).where(
        and_(
            models.Document.order_id == order_id,
            models.Document.doc_type == request.docType,
        )
    )
    result = await db.execute(doc_stmt)
    target_doc = result.scalar_one_or_none()

    if target_doc:
        # Update existing
        target_doc.file_name = source_doc.file_name
        target_doc.file_path = new_file_path
        target_doc.uploaded_at = datetime.utcnow()
        target_doc.uploaded_by = current_user.id
    else:
        # Create new
        new_doc = models.Document(
            order_id=order_id,
            doc_type=request.docType,
            file_name=source_doc.file_name,
            file_path=new_file_path,
            uploaded_at=datetime.utcnow(),
            uploaded_by=current_user.id
        )
        db.add(new_doc)
    
    # 5. Update Order status
    if order.status == models.OrderStatus.REJECTED:
        # If it was rejected, check if this upload addresses the issue? 
        # For simplicity, if they are re-uploading, reset to PENDING_UPLOAD or keep as REJECTED until they submit
        # Usually 'PENDING_UPLOAD' is appropriate if they are fixing things.
        order.status = models.OrderStatus.PENDING_UPLOAD
    
    # Log the action
    log = models.OrderLog(
        order_id=order_id,
        action=f"复用文档 {request.docType}",
        actor=current_user.username,
        details=f"Reused from PO: {source_order.id}, Part: {source_order.part_number}",
        timestamp=datetime.utcnow()
    )
    db.add(log)

    await db.commit()

    return {"status": "success", "message": "Document reused successfully"}
