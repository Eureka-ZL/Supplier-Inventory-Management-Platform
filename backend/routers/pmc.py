from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Request
from fastapi.responses import HTMLResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc, func
from typing import List, Dict, Any, Tuple, Literal
import os
import logging
import json
import ast
import tempfile
import threading
import time
from urllib.parse import urlparse
import httpx
import models
import schemas
from config import settings
from database import get_db
from routers.auth import ensure_super_admin, get_current_user
from tasks import sync_latest_inventory_email
from google_auth_oauthlib.flow import InstalledAppFlow
from services.gmail_service import GmailService, CREDENTIALS_FILE, TOKEN_FILE, SCOPES
from services.inventory_parser import InventoryParser
from services.bom_override_service import (
    import_bom_zip_into_database,
    get_bom_database_status,
    load_bom_products_from_database,
    build_inventory_parser_from_database,
    save_bom_product_parts,
)
from services.change_log_service import (
    create_inventory_change_log,
    fetch_pmc_history_events,
    cleanup_old_pmc_history_events,
    permanently_delete_pmc_history_event,
    permanently_delete_pmc_history_events,
    restore_pmc_history_event,
    restore_pmc_history_events,
    soft_delete_pmc_history_event,
    soft_delete_pmc_history_events,
    count_pmc_history_stats,
)
from services.audit_log_service import create_audit_log
from services.inventory_adjustment_runtime_service import (
    get_latest_official_inventory_record,
    list_official_inventory_records,
)
from services.inventory_reconciliation_cycle_service import (
    handle_new_inventory_upload,
    lock_reconciliation_cycle,
    get_latest_reconciliation_cycle,
)
from import_suppliers import import_suppliers_from_excel
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/pmc", tags=["PMC Inventory"])
MAX_TARGET_UNITS = 10000
GMAIL_OAUTH_FLOW_TTL_SECONDS = 600
_gmail_oauth_flows: Dict[str, Dict[str, Any]] = {}
_gmail_oauth_lock = threading.Lock()


class InventoryTargetGapRequest(BaseModel):
    record_id: int
    product_name: str
    product_code: str = ""
    target_units: int
    target_scope: Literal["finished", "subassembly"] = "finished"


class InventoryTargetGapBatchItem(BaseModel):
    row_id: str
    line: str
    product_name: str
    product_code: str = ""
    target_units: int


class InventoryTargetGapBatchRequest(BaseModel):
    record_id: int
    targets: List[InventoryTargetGapBatchItem]
    target_scope: Literal["finished", "subassembly"] = "finished"


class BomPartPayload(BaseModel):
    part_no: str
    name: str = ""
    spec: str = ""
    qty: float = 1
    manufacturer: str = ""
    alt_group: int | None = None


class BomProductPartsUpdateRequest(BaseModel):
    parts: List[BomPartPayload]


class HistoryDeleteItem(BaseModel):
    event_type: str
    event_id: int


class HistoryBulkDeleteRequest(BaseModel):
    events: List[HistoryDeleteItem]


class HistoryCleanupRequest(BaseModel):
    older_than_days: int
    event_scope: str = "all"


def _ensure_admin_role(current_user: models.User) -> None:
    ensure_super_admin(current_user, "仅超级管理员可导入基础资料")


def deserialize_inventory_raw_data(raw_data: str) -> Dict[str, Any]:
    if not raw_data or not raw_data.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="库存记录缺少可重算的原始数据"
        )
    raw_text = raw_data.strip()
    try:
        parsed = json.loads(raw_text)
        if isinstance(parsed, dict):
            return parsed
    except Exception:
        pass
    try:
        parsed = ast.literal_eval(raw_text)
        if isinstance(parsed, dict):
            return parsed
    except Exception:
        pass
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="库存记录原始数据格式无法识别，无法重算"
    )


def build_capacity_analysis(
    parser: InventoryParser,
    parsed_data: Dict[str, Any],
) -> Tuple[Dict[str, Any], List[Dict[str, Any]], Dict[str, float]]:
    parsed_data = parser.sanitize_inventory_dataset(parsed_data)
    bom_models_all = parser._extract_bom_models()
    bom_models = parser._get_finished_models(bom_models_all)
    bom_code_index = parser._build_product_code_index(bom_models_all)
    part_meta_index = parser._build_part_meta_index(bom_models_all)
    inv_items = parsed_data.get("items", {})

    product_details = []
    for product, model in bom_models.items():
        result = parser.evaluate_product_capacity(
            product,
            model,
            inv_items,
            bom_code_index=bom_code_index,
            part_meta_index=part_meta_index,
        )
        product_details.append(result)

    capacity_data = parser.calculate_production_capacity(parsed_data)
    return capacity_data, product_details, inv_items


def _get_target_gap_scope_models(
    parser: InventoryParser,
    target_scope: Literal["finished", "subassembly"],
) -> Dict[str, Dict[str, Any]]:
    bom_models_all = parser._extract_bom_models()
    if target_scope == "finished":
        scoped_models = parser._get_finished_models(bom_models_all)
    else:
        scoped_models = {
            key: model
            for key, model in bom_models_all.items()
            if parser._resolve_bom_tier(str(model.get("product_code", "")).strip()) in {"head", "pcba"}
        }
    return scoped_models


def _resolve_target_gap_model(
    parser: InventoryParser,
    scoped_models: Dict[str, Dict[str, Any]],
    product_name_raw: str,
    product_code_raw: str = "",
) -> Tuple[str, Dict[str, Any]] | Tuple[None, None]:
    product_code_query = parser._normalize_part_no(str(product_code_raw or "").strip())
    if product_code_query:
        for key, model in scoped_models.items():
            product_code = parser._normalize_part_no(str(model.get("product_code", "")).strip())
            if product_code and product_code == product_code_query:
                return key, model

    if product_name_raw in scoped_models:
        return product_name_raw, scoped_models[product_name_raw]

    normalized_query = str(product_name_raw or "").strip().lower()
    for key, model in scoped_models.items():
        product_code = str(model.get("product_code", "")).strip()
        product_name = str(model.get("product_name", "")).strip()
        if (
            normalized_query == str(key).strip().lower()
            or (product_code and product_code in product_name_raw)
            or (product_name and product_name.lower() == normalized_query)
        ):
            return key, model
    return None, None


def _resolve_frontend_base_url(request: Request | None = None) -> str:
    origin = request.headers.get("origin") if request else None
    base_url = origin or settings.frontend_base_url
    return base_url.rstrip("/")


def _build_gmail_redirect_uri(request: Request | None = None) -> str:
    return f"{_resolve_frontend_base_url(request)}{settings.gmail_oauth_callback_path}"


def _configure_oauth_transport(frontend_base_url: str) -> None:
    hostname = urlparse(frontend_base_url).hostname or ""
    if hostname in {"localhost", "127.0.0.1", "::1"}:
        # Local development cannot use HTTPS loopback in our current setup.
        os.environ["OAUTHLIB_INSECURE_TRANSPORT"] = "1"
    else:
        os.environ.pop("OAUTHLIB_INSECURE_TRANSPORT", None)


def _cleanup_expired_gmail_oauth_flows() -> None:
    cutoff = time.time() - GMAIL_OAUTH_FLOW_TTL_SECONDS
    with _gmail_oauth_lock:
        expired_states = [
            state for state, payload in _gmail_oauth_flows.items()
            if payload.get("created_at", 0) < cutoff
        ]
        for state in expired_states:
            _gmail_oauth_flows.pop(state, None)


def _store_gmail_oauth_flow(state: str, flow: InstalledAppFlow, frontend_base_url: str) -> None:
    with _gmail_oauth_lock:
        _gmail_oauth_flows[state] = {
            "flow": flow,
            "created_at": time.time(),
            "frontend_base_url": frontend_base_url,
        }


def _pop_gmail_oauth_flow(state: str) -> Dict[str, Any] | None:
    with _gmail_oauth_lock:
        return _gmail_oauth_flows.pop(state, None)


def _clear_gmail_oauth_flows() -> int:
    with _gmail_oauth_lock:
        cleared = len(_gmail_oauth_flows)
        _gmail_oauth_flows.clear()
    return cleared


async def _revoke_google_oauth_token(token_value: str) -> bool:
    if not token_value:
        return False

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(
                "https://oauth2.googleapis.com/revoke",
                data={"token": token_value},
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
        if response.status_code == status.HTTP_200_OK:
            return True
        logger.warning(
            "Google OAuth revoke returned status=%s body=%s",
            response.status_code,
            response.text[:200],
        )
    except Exception as exc:
        logger.warning("Failed to revoke Google OAuth token remotely: %s", exc)
    return False


def _build_gmail_oauth_popup_html(success: bool, frontend_base_url: str, message: str) -> HTMLResponse:
    payload = json.dumps(
        {
            "type": "gmail-oauth-complete",
            "success": success,
            "message": message,
        },
        ensure_ascii=False,
    )
    fallback_target = f"{frontend_base_url}/?gmail_authorized={'true' if success else 'false'}"
    body_text = "授权成功，窗口即将自动关闭。" if success else f"授权失败：{message}"
    title = "Gmail 授权成功" if success else "Gmail 授权失败"
    html = f"""<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <title>{title}</title>
  </head>
  <body>
    <p>{body_text}</p>
    <script>
      const payload = {payload};
      try {{
        if (window.opener && !window.opener.closed) {{
          window.opener.postMessage(payload, window.location.origin);
          window.close();
        }}
      }} catch (err) {{
        console.error(err);
      }}
      setTimeout(() => {{
        window.location.href = {json.dumps(fallback_target, ensure_ascii=False)};
      }}, 1200);
    </script>
  </body>
</html>"""
    return HTMLResponse(content=html)

# ===== Gmail OAuth Web Flow =====

@router.get("/gmail/status")
async def gmail_status():
    """Check if Gmail is authorized"""
    is_authorized = os.path.isfile(TOKEN_FILE)
    if is_authorized:
        gmail = GmailService()
        is_authorized = gmail.is_ready()
    return {"authorized": is_authorized}


@router.get("/gmail/authorize")
async def gmail_authorize(
    request: Request,
    current_user: models.User = Depends(get_current_user),
):
    """
    Start the OAuth2 authorization flow.
    Returns a Google consent URL and completes the token exchange via
    the backend callback endpoint instead of a loopback localhost server.
    """
    if not os.path.exists(CREDENTIALS_FILE):
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="OAuth credentials file not found on server"
        )

    _cleanup_expired_gmail_oauth_flows()
    frontend_base_url = _resolve_frontend_base_url(request)
    _configure_oauth_transport(frontend_base_url)

    flow = InstalledAppFlow.from_client_secrets_file(CREDENTIALS_FILE, SCOPES)
    flow.redirect_uri = f"{frontend_base_url}{settings.gmail_oauth_callback_path}"
    auth_url, state = flow.authorization_url(
        access_type='offline',
        include_granted_scopes='true',
        prompt='consent'
    )
    if not state:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create OAuth state"
        )

    _store_gmail_oauth_flow(
        state=state,
        flow=flow,
        frontend_base_url=frontend_base_url,
    )
    logger.info(
        "Started Gmail OAuth flow for user=%s redirect_uri=%s",
        current_user.username,
        flow.redirect_uri,
    )

    return {"authorization_url": auth_url}


@router.delete("/gmail/authorize")
async def gmail_revoke_authorization(
    current_user: models.User = Depends(get_current_user),
):
    """Revoke the saved Gmail authorization for the current deployment."""
    if current_user.role not in [models.UserRole.PMC, models.UserRole.ADMIN]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to manage Gmail authorization"
        )

    token_payload: Dict[str, Any] = {}
    token_file_exists = os.path.isfile(TOKEN_FILE)
    if token_file_exists:
        try:
            with open(TOKEN_FILE, "r", encoding="utf-8") as token_file:
                parsed = json.load(token_file)
                if isinstance(parsed, dict):
                    token_payload = parsed
        except Exception as exc:
            logger.warning("Failed to read Gmail token payload before revoke: %s", exc)

    remote_revoked = False
    token_candidates = [
        str(token_payload.get("refresh_token") or "").strip(),
        str(token_payload.get("token") or "").strip(),
    ]
    for candidate in token_candidates:
        if not candidate:
            continue
        remote_revoked = await _revoke_google_oauth_token(candidate)
        if remote_revoked:
            break

    if token_file_exists:
        try:
            os.remove(TOKEN_FILE)
        except FileNotFoundError:
            pass
        except OSError as exc:
            logger.exception("Failed to remove local Gmail token file")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"无法移除本地授权凭证: {exc}"
            )

    cleared_flows = _clear_gmail_oauth_flows()
    logger.info(
        "Gmail authorization revoked by user=%s remote_revoked=%s cleared_flows=%s",
        current_user.username,
        remote_revoked,
        cleared_flows,
    )

    if not token_file_exists and cleared_flows == 0:
        return {
            "success": True,
            "authorized": False,
            "message": "当前没有可取消的邮箱授权",
            "remote_revoked": False,
        }

    message = "邮箱授权已取消，系统将停止自动读取 Gmail 邮件"
    if token_file_exists and not remote_revoked:
        message += "；本地凭证已移除"

    return {
        "success": True,
        "authorized": False,
        "message": message,
        "remote_revoked": remote_revoked,
    }


@router.get("/gmail/oauth/callback", response_class=HTMLResponse)
async def gmail_oauth_callback(request: Request):
    frontend_base_url = _resolve_frontend_base_url(request)

    if request.query_params.get("error"):
        message = request.query_params.get("error_description") or request.query_params.get("error") or "用户取消了授权"
        logger.warning("Gmail OAuth denied by Google: %s", message)
        return _build_gmail_oauth_popup_html(False, frontend_base_url, message)

    state = request.query_params.get("state")
    if not state:
        logger.warning("Gmail OAuth callback missing state")
        return _build_gmail_oauth_popup_html(False, frontend_base_url, "授权会话缺少 state 参数")

    flow_payload = _pop_gmail_oauth_flow(state)
    if not flow_payload:
        logger.warning("Gmail OAuth callback received unknown or expired state")
        return _build_gmail_oauth_popup_html(False, frontend_base_url, "授权会话已过期，请重新发起授权")

    frontend_base_url = flow_payload.get("frontend_base_url") or frontend_base_url
    _configure_oauth_transport(frontend_base_url)
    flow = flow_payload["flow"]

    try:
        query_string = request.url.query
        authorization_response = f"{frontend_base_url}{settings.gmail_oauth_callback_path}"
        if query_string:
            authorization_response = f"{authorization_response}?{query_string}"

        flow.fetch_token(authorization_response=authorization_response)
        creds = flow.credentials
        with open(TOKEN_FILE, 'w') as f:
            f.write(creds.to_json())
        logger.info("Gmail OAuth authorization completed successfully")
        return _build_gmail_oauth_popup_html(True, frontend_base_url, "授权成功")
    except Exception as e:
        logger.exception("Gmail OAuth callback failed")
        return _build_gmail_oauth_popup_html(False, frontend_base_url, str(e))


# ===== Inventory Data Endpoints =====

@router.get("/bom/list")
async def get_bom_list(
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return all BOM products with full component details"""
    if current_user.role not in [models.UserRole.PMC, models.UserRole.ADMIN]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized"
        )
    products = await load_bom_products_from_database(db)
    return {"products": products, "total_products": len(products)}


@router.get("/bom/status")
async def get_bom_status(
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return runtime BOM database status for PMC UI."""
    if current_user.role not in [models.UserRole.PMC, models.UserRole.ADMIN]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized"
        )
    return await get_bom_database_status(db)


@router.post("/admin/import/bom-zip")
async def import_bom_zip(
    file: UploadFile = File(...),
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _ensure_admin_role(current_user)
    filename = file.filename or ""
    if not filename.lower().endswith(".zip"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="请上传 .zip 格式的 BOM 压缩包",
        )

    suffix = os.path.splitext(filename)[1] or ".zip"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
        temp_path = temp_file.name
        temp_file.write(await file.read())

    try:
        summary = await import_bom_zip_into_database(db, zip_path=temp_path, overwrite=True)
        await create_audit_log(
            db,
            scope="admin",
            action="bom_zip_imported",
            actor=str(getattr(current_user, "username", "") or "admin"),
            entity_type="bom_import",
            title="BOM 压缩包已导入",
            summary=filename or "未命名 BOM 压缩包",
            detail={"file_name": filename, "summary": summary},
        )
        await db.commit()
        status_summary = await get_bom_database_status(db)
        return {
            "success": True,
            "message": "BOM 压缩包已导入数据库",
            "file_name": filename,
            "summary": summary,
            "status": status_summary,
        }
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Failed to import BOM zip: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="BOM 压缩包导入失败",
        )
    finally:
        if os.path.exists(temp_path):
            os.unlink(temp_path)


@router.post("/admin/import/suppliers")
async def import_suppliers_excel(
    file: UploadFile = File(...),
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    _ensure_admin_role(current_user)
    filename = file.filename or ""
    if not filename.lower().endswith((".xls", ".xlsx")):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="请上传 Excel 格式的供应商资料表",
        )

    supplier_count_before = int((
        await db.execute(
            select(func.count(models.Supplier.id)).where(models.Supplier.is_deleted.is_(False))
        )
    ).scalar() or 0)
    contact_count_before = int((await db.execute(select(func.count(models.SupplierContact.id)))).scalar() or 0)

    suffix = os.path.splitext(filename)[1] or ".xlsx"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
        temp_path = temp_file.name
        temp_file.write(await file.read())

    try:
        summary = await import_suppliers_from_excel(temp_path, db)
        await create_audit_log(
            db,
            scope="admin",
            action="supplier_excel_imported",
            actor=str(getattr(current_user, "username", "") or "admin"),
            entity_type="supplier_import",
            title="供应商资料表已导入",
            summary=filename or "未命名供应商资料表",
            detail={"file_name": filename, "summary": summary},
        )
        await db.commit()
        supplier_count_after = int((
            await db.execute(
                select(func.count(models.Supplier.id)).where(models.Supplier.is_deleted.is_(False))
            )
        ).scalar() or 0)
        contact_count_after = int((await db.execute(select(func.count(models.SupplierContact.id)))).scalar() or 0)
        return {
            "success": True,
            "message": "供应商资料表已全量覆盖到数据库",
            "file_name": filename,
            "summary": {
                "active_supplier_count": supplier_count_after,
                "contact_count": contact_count_after,
                "created_supplier_count": summary["created_supplier_count"],
                "updated_supplier_count": summary["updated_supplier_count"],
                "archived_supplier_count": summary["archived_supplier_count"],
                "replaced_contact_count": summary["replaced_contact_count"],
                "active_supplier_delta": supplier_count_after - supplier_count_before,
                "contact_delta": contact_count_after - contact_count_before,
            },
        }
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Failed to import suppliers excel: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="供应商资料表导入失败",
        )
    finally:
        if os.path.exists(temp_path):
            os.unlink(temp_path)


@router.put("/bom/product/{product_code}/parts")
async def update_bom_product_parts(
    product_code: str,
    request: BomProductPartsUpdateRequest,
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update/publish BOM parts for one existing product code."""
    if current_user.role not in [models.UserRole.PMC, models.UserRole.ADMIN]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized"
        )
    try:
        updated = await save_bom_product_parts(
            db=db,
            product_code=product_code,
            parts=[part.model_dump() for part in request.parts],
            actor=str(getattr(current_user, "username", "") or "pmc"),
        )
        await create_audit_log(
            db,
            scope="pmc",
            action="bom_product_parts_updated",
            actor=str(getattr(current_user, "username", "") or "pmc"),
            entity_type="bom_product",
            entity_id=product_code,
            title="BOM 已更新",
            summary=str(updated.get("product_name") or product_code),
            detail={
                "product_code": product_code,
                "product_name": updated.get("product_name"),
                "part_count": len(request.parts),
            },
        )
        await db.commit()
        return {"success": True, "product": updated}
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )


@router.get("/inventory/latest", response_model=List[schemas.InventoryRecordResponse])
async def get_latest_inventory(
    limit: int = 5,
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get the most recent official inventory-sheet records"""
    if current_user.role not in [models.UserRole.PMC, models.UserRole.ADMIN]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to access inventory data"
        )

    safe_limit = max(1, min(limit, 20))
    return await list_official_inventory_records(db=db, limit=safe_limit)


@router.get("/history/events")
async def get_pmc_history_events(
    limit: int = 100,
    include_deleted: bool = False,
    deleted_only: bool = False,
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if current_user.role not in [models.UserRole.PMC, models.UserRole.ADMIN]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to access PMC history"
        )
    safe_limit = max(1, min(limit, 500))
    events = await fetch_pmc_history_events(
        db,
        limit=safe_limit,
        include_deleted=include_deleted,
        deleted_only=deleted_only,
    )
    stats = await count_pmc_history_stats(db)
    return {
        "events": events,
        "total": len(events),
        "active_count": stats["active_count"],
        "archived_count": stats["archived_count"],
    }


@router.delete("/history/event/{event_type}/{event_id}")
async def delete_pmc_history_event(
    event_type: str,
    event_id: int,
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if current_user.role not in [models.UserRole.PMC, models.UserRole.ADMIN]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to delete PMC history"
        )
    normalized_type = (event_type or "").strip().lower()
    if normalized_type not in {"bom_change", "inventory_change", "audit_log"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unsupported history event type",
        )
    deleted = await soft_delete_pmc_history_event(
        db,
        event_type=normalized_type,
        event_id=event_id,
        deleted_by=str(getattr(current_user, "username", "") or "pmc"),
    )
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="History event not found",
        )
    await db.commit()
    return {"success": True}


@router.post("/history/events/delete")
async def bulk_delete_pmc_history_events(
    request: HistoryBulkDeleteRequest,
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if current_user.role not in [models.UserRole.PMC, models.UserRole.ADMIN]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to delete PMC history"
        )
    deleted_count = await soft_delete_pmc_history_events(
        db,
        events=[item.model_dump() for item in request.events],
        deleted_by=str(getattr(current_user, "username", "") or "pmc"),
    )
    await db.commit()
    return {"success": True, "deleted_count": deleted_count}


@router.post("/history/events/restore")
async def bulk_restore_pmc_history_events(
    request: HistoryBulkDeleteRequest,
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if current_user.role not in [models.UserRole.PMC, models.UserRole.ADMIN]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to restore PMC history"
        )
    restored_count = await restore_pmc_history_events(
        db,
        events=[item.model_dump() for item in request.events],
    )
    await db.commit()
    return {"success": True, "restored_count": restored_count}


@router.post("/history/event/{event_type}/{event_id}/restore")
async def restore_single_pmc_history_event(
    event_type: str,
    event_id: int,
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if current_user.role not in [models.UserRole.PMC, models.UserRole.ADMIN]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to restore PMC history"
        )
    normalized_type = (event_type or "").strip().lower()
    if normalized_type not in {"bom_change", "inventory_change", "audit_log"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unsupported history event type",
        )
    restored = await restore_pmc_history_event(
        db,
        event_type=normalized_type,
        event_id=event_id,
    )
    if not restored:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="History event not found",
        )
    await db.commit()
    return {"success": True}


@router.delete("/history/event/{event_type}/{event_id}/permanent")
async def permanently_delete_single_pmc_history_event(
    event_type: str,
    event_id: int,
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if current_user.role not in [models.UserRole.PMC, models.UserRole.ADMIN]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to permanently delete PMC history"
        )
    normalized_type = (event_type or "").strip().lower()
    if normalized_type not in {"bom_change", "inventory_change", "audit_log"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unsupported history event type",
        )
    deleted = await permanently_delete_pmc_history_event(
        db,
        event_type=normalized_type,
        event_id=event_id,
    )
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Archived history event not found",
        )
    await db.commit()
    return {"success": True}


@router.post("/history/events/permanent-delete")
async def bulk_permanently_delete_pmc_history_events(
    request: HistoryBulkDeleteRequest,
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if current_user.role not in [models.UserRole.PMC, models.UserRole.ADMIN]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to permanently delete PMC history"
        )
    deleted_count = await permanently_delete_pmc_history_events(
        db,
        events=[item.model_dump() for item in request.events],
    )
    await db.commit()
    return {"success": True, "deleted_count": deleted_count}


@router.post("/history/events/cleanup")
async def cleanup_pmc_history_events(
    request: HistoryCleanupRequest,
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if current_user.role not in [models.UserRole.PMC, models.UserRole.ADMIN]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to cleanup PMC history"
        )
    if request.event_scope not in {"all", "bom_change", "inventory_change", "audit_log"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unsupported cleanup event scope",
        )
    result = await cleanup_old_pmc_history_events(
        db,
        older_than_days=request.older_than_days,
        deleted_by=str(getattr(current_user, "username", "") or "pmc"),
        event_scope=request.event_scope,
    )
    await db.commit()
    return {"success": True, "result": result, "total_deleted": sum(result.values())}


@router.get("/inventory/record/{record_id}")
async def get_inventory_record_detail(
    record_id: int,
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get parsed inventory + capacity detail by record id (same shape as upload response)."""
    if current_user.role not in [models.UserRole.PMC, models.UserRole.ADMIN]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to access inventory data"
        )

    result = await db.execute(
        select(models.InventoryRecord).where(models.InventoryRecord.id == record_id)
    )
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="库存记录不存在"
        )

    parser = await build_inventory_parser_from_database(db)
    parsed_data = parser.sanitize_inventory_dataset(
        deserialize_inventory_raw_data(record.raw_data or "")
    )
    capacity_data, product_details, inv_items = build_capacity_analysis(
        parser=parser,
        parsed_data=parsed_data,
    )

    inventory_rows = parsed_data.get("inventory_rows") or []
    if inventory_rows:
        inventory_items = inventory_rows
        total_items = len(inventory_rows)
    else:
        inventory_items = [
            {"part_no": part, "quantity": qty}
            for part, qty in sorted(inv_items.items())
        ]
        total_items = len(inventory_items)

    return {
        "success": True,
        "record_id": record.id,
        "inventory": {
            "items": inventory_items,
            "total_items": total_items,
            "unique_part_count": len(inv_items),
        },
        "capacity_analysis": {
            "best_capacity": capacity_data.get("capacity", 0),
            "overall_bottleneck": capacity_data.get("bottleneck", ""),
            "products": product_details,
        }
    }

@router.post("/inventory/sync")
async def trigger_manual_sync(
    current_user: models.User = Depends(get_current_user)
):
    """Manually sync the latest inventory email and return sync details."""
    if current_user.role not in [models.UserRole.PMC, models.UserRole.ADMIN]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to trigger sync"
        )

    # Check Gmail authorization first
    gmail = GmailService()
    if not gmail.is_ready():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Gmail 尚未授权，请先点击「授权 Gmail」按钮"
        )

    result = await sync_latest_inventory_email()
    if not result.get("success") and result.get("status") == "unauthorized":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=result.get("message") or "Gmail 尚未授权"
        )
    return result


class ReconciliationLockRequest(BaseModel):
    closing_record_id: int
    note: str = ""


@router.get("/inventory/reconciliation/status")
async def get_reconciliation_status(
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return the current reconciliation cycle status and available records for locking."""
    if current_user.role not in [models.UserRole.PMC, models.UserRole.ADMIN]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to access reconciliation status"
        )

    open_cycle = await get_latest_reconciliation_cycle(db, status="open")
    locked_cycle = await get_latest_reconciliation_cycle(db, status="locked")

    # Gather available inventory records (excluding the base record) for locking
    available_records = []
    if open_cycle is not None:
        records = await list_official_inventory_records(db, limit=10)
        for record in records:
            if int(record.id) != int(open_cycle.base_record_id):
                available_records.append({
                    "id": int(record.id),
                    "file_name": record.file_name,
                    "source_email": record.source_email,
                    "parsed_at": record.parsed_at.isoformat() if record.parsed_at else None,
                })

    return {
        "open_cycle": {
            "id": int(open_cycle.id),
            "base_record_id": int(open_cycle.base_record_id),
            "closing_record_id": int(open_cycle.closing_record_id) if open_cycle.closing_record_id else None,
            "has_closing": open_cycle.closing_record_id is not None,
            "status": open_cycle.status,
            "note": open_cycle.note,
            "created_at": open_cycle.created_at.isoformat() if open_cycle.created_at else None,
        } if open_cycle else None,
        "latest_locked_cycle": {
            "id": int(locked_cycle.id),
            "base_record_id": int(locked_cycle.base_record_id),
            "closing_record_id": int(locked_cycle.closing_record_id) if locked_cycle.closing_record_id else None,
            "status": locked_cycle.status,
            "locked_at": locked_cycle.locked_at.isoformat() if locked_cycle.locked_at else None,
            "locked_by": locked_cycle.locked_by,
        } if locked_cycle else None,
        "available_closing_records": available_records,
    }


@router.post("/inventory/reconciliation/lock")
async def lock_current_reconciliation_cycle(
    request: ReconciliationLockRequest,
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Lock the current open reconciliation cycle with the user-selected closing record."""
    if current_user.role not in [models.UserRole.PMC, models.UserRole.ADMIN]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to lock reconciliation cycle"
        )

    try:
        locked_cycle, new_cycle = await lock_reconciliation_cycle(
            db,
            closing_record_id=request.closing_record_id,
            actor=str(getattr(current_user, "username", "") or "pmc"),
            note=request.note or None,
        )
        await db.commit()
        return {
            "success": True,
            "message": "对账周期已锁定，新周期已自动开启",
            "locked_cycle": {
                "id": int(locked_cycle.id),
                "base_record_id": int(locked_cycle.base_record_id),
                "closing_record_id": int(locked_cycle.closing_record_id) if locked_cycle.closing_record_id else None,
                "status": locked_cycle.status,
                "locked_at": locked_cycle.locked_at.isoformat() if locked_cycle.locked_at else None,
            },
            "new_cycle": {
                "id": int(new_cycle.id),
                "base_record_id": int(new_cycle.base_record_id),
                "status": new_cycle.status,
            },
        }
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        )


@router.post("/inventory/upload")
async def upload_inventory_excel(
    file: UploadFile = File(...),
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Manual Excel upload fallback.
    Accepts .xlsx / .xls / .csv files, parses them, and calculates capacity.
    Returns detailed BOM matching and inventory data.
    """
    if current_user.role not in [models.UserRole.PMC, models.UserRole.ADMIN]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to upload inventory data"
        )

    # Validate file type
    allowed_extensions = ('.xlsx', '.xls', '.csv')
    if not file.filename or not file.filename.lower().endswith(allowed_extensions):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"不支持的文件格式，请上传 {', '.join(allowed_extensions)} 文件"
        )

    try:
        file_content = await file.read()

        parser = await build_inventory_parser_from_database(db)
        parsed_data = parser.parse_excel_attachment(file_content, file.filename)

        if "error" in parsed_data:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"文件解析失败: {parsed_data['error']}"
            )

        capacity_data, product_details, inv_items = build_capacity_analysis(
            parser=parser,
            parsed_data=parsed_data,
        )

        previous_record = await get_latest_official_inventory_record(db)

        record = models.InventoryRecord(
            source_email="手动上传",
            file_name=file.filename,
            raw_data=json.dumps(parsed_data, ensure_ascii=False),
            calculated_capacity=capacity_data.get("capacity", 0),
            bottleneck_material=capacity_data.get("bottleneck", ""),
            notes=capacity_data.get("notes", "")
        )
        db.add(record)
        await db.commit()
        await db.refresh(record)
        await create_inventory_change_log(
            db=db,
            record=record,
            source="manual_upload",
            previous_record=previous_record,
        )
        await handle_new_inventory_upload(
            db,
            new_record=record,
            actor=str(getattr(current_user, "username", "") or "pmc"),
            note=f"期初库存表：{file.filename}",
        )
        await create_audit_log(
            db,
            scope="pmc",
            action="inventory_sheet_uploaded",
            actor=str(getattr(current_user, "username", "") or "pmc"),
            entity_type="inventory_record",
            entity_id=record.id,
            title="库存表已上传",
            summary=file.filename or "未命名库存表",
            detail={
                "record_id": int(record.id),
                "file_name": file.filename,
                "previous_record_id": int(previous_record.id) if previous_record is not None else None,
                "capacity": int(capacity_data.get("capacity", 0) or 0),
                "bottleneck": str(capacity_data.get("bottleneck", "") or ""),
            },
        )
        await db.commit()

        # Build inventory items list for frontend display.
        # Prefer full parsed rows (e.g. 材料汇总表 with 描述/良品/不良/合计).
        inventory_rows = parsed_data.get("inventory_rows") or []
        if inventory_rows:
            inventory_items = inventory_rows
            total_items = len(inventory_rows)
        else:
            inventory_items = [
                {"part_no": part, "quantity": qty}
                for part, qty in sorted(inv_items.items())
            ]
            total_items = len(inventory_items)

        return {
            "success": True,
            "message": f"文件 {file.filename} 解析成功",
            "record_id": record.id,
            "inventory": {
                "items": inventory_items,
                "total_items": total_items,
                "unique_part_count": len(inv_items),
            },
            "capacity_analysis": {
                "best_capacity": capacity_data.get("capacity", 0),
                "overall_bottleneck": capacity_data.get("bottleneck", ""),
                "products": product_details,
            }
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Upload processing failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"处理失败: {str(e)}"
        )

@router.post("/inventory/target-gap")
async def analyze_inventory_target_gap(
    request: InventoryTargetGapRequest,
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Analyze shortage gap for one BOM target under a target units request.
    """
    if current_user.role not in [models.UserRole.PMC, models.UserRole.ADMIN]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to analyze target gap"
        )

    if int(request.target_units) <= 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="目标台数必须大于 0"
        )
    if int(request.target_units) > MAX_TARGET_UNITS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"目标台数不能超过 {MAX_TARGET_UNITS}"
        )

    result = await db.execute(
        select(models.InventoryRecord).where(models.InventoryRecord.id == request.record_id)
    )
    record = result.scalar_one_or_none()
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"库存记录不存在: id={request.record_id}"
        )

    parser = await build_inventory_parser_from_database(db)
    parsed_data = parser.sanitize_inventory_dataset(
        deserialize_inventory_raw_data(record.raw_data or "")
    )
    inv_items = parsed_data.get("items", {})

    bom_models_all = parser._extract_bom_models()
    target_scope = request.target_scope
    scoped_models = _get_target_gap_scope_models(parser, target_scope)
    bom_code_index = parser._build_product_code_index(bom_models_all)
    part_meta_index = parser._build_part_meta_index(bom_models_all)

    product_name_raw = str(request.product_name or "").strip()
    if not product_name_raw:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="产品不能为空"
        )

    selected_key, selected_model = _resolve_target_gap_model(
        parser=parser,
        scoped_models=scoped_models,
        product_name_raw=product_name_raw,
        product_code_raw=request.product_code,
    )

    if selected_model is None or selected_key is None:
        scope_label = "成品机" if target_scope == "finished" else "子装配"
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"未找到{scope_label}BOM: {product_name_raw or request.product_code}"
        )

    gap_result = parser.analyze_target_gap(
        product_name=selected_key,
        product_model=selected_model,
        inv_items=inv_items,
        target_units=int(request.target_units),
        bom_code_index=bom_code_index,
        part_meta_index=part_meta_index,
    )

    return {
        "success": True,
        "record_id": record.id,
        "target_gap": gap_result,
    }


@router.post("/inventory/target-gap-batch")
async def analyze_inventory_target_gap_batch(
    request: InventoryTargetGapBatchRequest,
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Analyze shortage gap for multiple BOM targets under one shared stock pool.
    """
    if current_user.role not in [models.UserRole.PMC, models.UserRole.ADMIN]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not authorized to analyze target gap"
        )

    if not request.targets:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="请至少提供一条目标对象"
        )
    total_target_units = sum(max(0, int(item.target_units or 0)) for item in request.targets)
    if total_target_units > MAX_TARGET_UNITS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"目标总台数不能超过 {MAX_TARGET_UNITS}"
        )

    result = await db.execute(
        select(models.InventoryRecord).where(models.InventoryRecord.id == request.record_id)
    )
    record = result.scalar_one_or_none()
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"库存记录不存在: id={request.record_id}"
        )

    parser = await build_inventory_parser_from_database(db)
    parsed_data = parser.sanitize_inventory_dataset(
        deserialize_inventory_raw_data(record.raw_data or "")
    )
    inv_items = parsed_data.get("items", {})

    bom_models_all = parser._extract_bom_models()
    target_scope = request.target_scope
    scoped_models = _get_target_gap_scope_models(parser, target_scope)
    bom_code_index = parser._build_product_code_index(bom_models_all)
    part_meta_index = parser._build_part_meta_index(bom_models_all)

    resolved_targets: List[Dict[str, Any]] = []
    for idx, item in enumerate(request.targets):
        if int(item.target_units) <= 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"第 {idx + 1} 行目标台数必须大于 0"
            )
        if int(item.target_units) > MAX_TARGET_UNITS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"第 {idx + 1} 行目标台数不能超过 {MAX_TARGET_UNITS}"
            )

        product_name_raw = str(item.product_name or "").strip()
        if not product_name_raw:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"第 {idx + 1} 行产品不能为空"
            )

        selected_key, selected_model = _resolve_target_gap_model(
            parser=parser,
            scoped_models=scoped_models,
            product_name_raw=product_name_raw,
            product_code_raw=item.product_code,
        )

        if selected_model is None or selected_key is None:
            scope_label = "成品机" if target_scope == "finished" else "子装配"
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"未找到{scope_label}BOM: {product_name_raw or item.product_code}"
            )

        resolved_targets.append(
            {
                "row_id": str(item.row_id or f"row-{idx + 1}"),
                "line": str(item.line or selected_model.get("line", "未分类")),
                "product_name": selected_key,
                "product_model": selected_model,
                "target_units": int(item.target_units),
            }
        )

    batch_result = parser.analyze_target_gap_batch(
        targets=resolved_targets,
        inv_items=inv_items,
        bom_code_index=bom_code_index,
        part_meta_index=part_meta_index,
    )

    return {
        "success": True,
        "record_id": record.id,
        "target_gap_batch": batch_result,
    }
