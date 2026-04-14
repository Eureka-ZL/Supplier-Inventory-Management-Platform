from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from typing import Optional
import models
import schemas
from database import get_db
from auth import (
    verify_password,
    get_password_hash,
    create_access_token,
    decode_access_token,
)
from services.audit_log_service import create_audit_log

router = APIRouter(prefix="/api/auth", tags=["Authentication"])
security = HTTPBearer()

INTERNAL_USER_ROLES = {
    models.UserRole.ADMIN,
    models.UserRole.IQC,
    models.UserRole.PMC,
}


async def _count_admin_users(db: AsyncSession) -> int:
    result = await db.execute(
        select(func.count(models.User.id)).where(
            models.User.role == models.UserRole.ADMIN,
            models.User.is_active.is_(True),
        )
    )
    return int(result.scalar() or 0)


async def _count_super_admin_users(db: AsyncSession) -> int:
    result = await db.execute(
        select(func.count(models.User.id)).where(
            models.User.role == models.UserRole.ADMIN,
            models.User.is_super_admin.is_(True),
            models.User.is_active.is_(True),
        )
    )
    return int(result.scalar() or 0)


def is_super_admin(user: models.User) -> bool:
    return user.role == models.UserRole.ADMIN and bool(
        getattr(user, "is_super_admin", False)
    )


def ensure_super_admin(user: models.User, detail: str = "Only super administrators can perform this action") -> None:
    if not is_super_admin(user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=detail,
        )


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: AsyncSession = Depends(get_db),
) -> models.User:
    """Dependency to get current authenticated user"""
    token = credentials.credentials
    payload = decode_access_token(token)

    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials",
        )

    username: str = payload.get("sub")
    if username is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials",
        )

    result = await db.execute(
        select(models.User).where(models.User.username == username)
    )
    user = result.scalar_one_or_none()

    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found"
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Inactive user"
        )

    return user


@router.post(
    "/register",
    response_model=schemas.UserResponse,
    status_code=status.HTTP_201_CREATED,
)
async def register(
    user_data: schemas.UserCreate,
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Register a new user (仅管理员可以创建用户)"""
    ensure_super_admin(current_user, "Only super administrators can create new users")

    # Check if username already exists
    result = await db.execute(
        select(models.User).where(models.User.username == user_data.username)
    )
    if result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already registered",
        )

    # Validate supplier_name for SUPPLIER role
    if user_data.role == models.UserRole.SUPPLIER and not user_data.supplier_name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Supplier name is required for SUPPLIER role",
        )

    # Create new user
    hashed_password = get_password_hash(user_data.password)
    new_user = models.User(
        username=user_data.username,
        hashed_password=hashed_password,
        role=user_data.role,
        is_super_admin=False,
        supplier_name=user_data.supplier_name,
    )

    db.add(new_user)
    await db.commit()
    await db.refresh(new_user)

    return new_user


@router.post("/login", response_model=schemas.Token)
async def login(
    user_credentials: schemas.UserLogin, db: AsyncSession = Depends(get_db)
):
    """Login user and enforce the selected portal role."""
    # Get user by username
    result = await db.execute(
        select(models.User).where(models.User.username == user_credentials.username)
    )
    user = result.scalar_one_or_none()

    if not user or not verify_password(user_credentials.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
        )

    if user.role != user_credentials.role:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"This account does not belong to the {user_credentials.role.value} portal",
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Inactive user"
        )

    # Create access token
    access_token = create_access_token(
        data={"sub": user.username, "role": user.role.value}
    )

    return {"access_token": access_token, "token_type": "bearer", "user": user}


@router.get("/me", response_model=schemas.UserResponse)
async def get_current_user_info(current_user: models.User = Depends(get_current_user)):
    """Get current user information"""
    return current_user


@router.get("/users", response_model=list[schemas.InternalUserResponse])
async def list_internal_users(
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List internal accounts for admin management."""
    ensure_super_admin(
        current_user,
        "Only super administrators can view internal users",
    )

    result = await db.execute(
        select(models.User)
        .where(models.User.role.in_(tuple(INTERNAL_USER_ROLES)))
        .order_by(models.User.created_at.desc(), models.User.id.desc())
    )
    return result.scalars().all()


@router.post(
    "/users",
    response_model=schemas.InternalUserResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_internal_user(
    user_data: schemas.InternalUserCreate,
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Create an internal ADMIN/IQC/PMC account."""
    ensure_super_admin(
        current_user,
        "Only super administrators can create internal users",
    )

    username = user_data.username.strip()
    password = user_data.password.strip()

    if not username:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username is required",
        )
    if len(password) < 6:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password must be at least 6 characters",
        )
    if user_data.role not in INTERNAL_USER_ROLES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only ADMIN, IQC, and PMC accounts can be created here",
        )
    if user_data.is_super_admin and user_data.role != models.UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only ADMIN accounts can be granted super administrator access",
        )

    result = await db.execute(
        select(models.User).where(models.User.username == username)
    )
    if result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already registered",
        )

    new_user = models.User(
        username=username,
        hashed_password=get_password_hash(password),
        plain_password=None,
        role=user_data.role,
        is_super_admin=bool(
            user_data.role == models.UserRole.ADMIN and user_data.is_super_admin
        ),
        supplier_name=None,
        is_active=True,
    )
    db.add(new_user)
    await db.commit()
    await db.refresh(new_user)
    await create_audit_log(
        db,
        scope="admin",
        action="internal_user_created",
        actor=str(getattr(current_user, "username", "") or "admin"),
        entity_type="user",
        entity_id=new_user.id,
        title="内部账户已创建",
        summary=f"{new_user.username} ({new_user.role.value})",
        detail={
            "user_id": int(new_user.id),
            "username": new_user.username,
            "role": new_user.role.value,
            "is_super_admin": bool(new_user.is_super_admin),
        },
    )
    await db.commit()
    return new_user


@router.put("/users/{user_id}", response_model=schemas.InternalUserResponse)
async def update_internal_user(
    user_id: int,
    user_data: schemas.InternalUserUpdate,
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update an internal account username."""
    ensure_super_admin(
        current_user,
        "Only super administrators can update internal users",
    )

    user = await db.get(models.User, user_id)
    if not user or user.role not in INTERNAL_USER_ROLES:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Internal user not found",
        )

    username = user_data.username.strip()
    if not username:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username is required",
        )

    result = await db.execute(
        select(models.User).where(models.User.username == username)
    )
    existing_user = result.scalar_one_or_none()
    if existing_user and existing_user.id != user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already registered",
        )

    next_super_admin = user.is_super_admin
    if user_data.is_super_admin is not None:
        if user.role != models.UserRole.ADMIN and user_data.is_super_admin:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Only ADMIN accounts can be granted super administrator access",
            )
        next_super_admin = bool(
            user.role == models.UserRole.ADMIN and user_data.is_super_admin
        )

    if (
        user.role == models.UserRole.ADMIN
        and user.is_super_admin
        and not next_super_admin
    ):
        super_admin_count = await _count_super_admin_users(db)
        if super_admin_count <= 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="At least one active super administrator must remain",
            )

    user.username = username
    user.is_super_admin = next_super_admin if user.role == models.UserRole.ADMIN else False
    await db.commit()
    await db.refresh(user)
    await create_audit_log(
        db,
        scope="admin",
        action="internal_user_updated",
        actor=str(getattr(current_user, "username", "") or "admin"),
        entity_type="user",
        entity_id=user.id,
        title="内部账户已更新",
        summary=f"{user.username} ({user.role.value})",
        detail={
            "user_id": int(user.id),
            "username": user.username,
            "role": user.role.value,
            "is_super_admin": bool(user.is_super_admin),
        },
    )
    await db.commit()
    return user


@router.put("/users/{user_id}/password")
async def update_internal_user_password(
    user_id: int,
    payload: schemas.InternalUserPasswordUpdateRequest,
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Reset an internal user's password directly from admin panel."""
    ensure_super_admin(
        current_user,
        "Only super administrators can reset internal user passwords",
    )

    user = await db.get(models.User, user_id)
    if not user or user.role not in INTERNAL_USER_ROLES:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Internal user not found",
        )

    new_password = payload.new_password.strip()
    if len(new_password) < 6:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="New password must be at least 6 characters",
        )
    if payload.new_password != payload.confirm_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="New password confirmation does not match",
        )

    user.hashed_password = get_password_hash(new_password)
    user.plain_password = None
    await db.commit()
    await create_audit_log(
        db,
        scope="admin",
        action="internal_user_password_reset",
        actor=str(getattr(current_user, "username", "") or "admin"),
        entity_type="user",
        entity_id=user.id,
        title="内部账户密码已重置",
        summary=f"{user.username} ({user.role.value})",
        detail={
            "user_id": int(user.id),
            "username": user.username,
            "role": user.role.value,
        },
    )
    await db.commit()
    return {"success": True, "message": "Password updated successfully"}


@router.delete("/users/{user_id}")
async def delete_internal_user(
    user_id: int,
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete an internal ADMIN/IQC/PMC account directly."""
    ensure_super_admin(
        current_user,
        "Only super administrators can delete internal users",
    )

    user = await db.get(models.User, user_id)
    if not user or user.role not in INTERNAL_USER_ROLES:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Internal user not found",
        )

    if user.id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current logged-in account cannot be deleted here",
        )

    if user.role == models.UserRole.ADMIN:
        admin_count = await _count_admin_users(db)
        if admin_count <= 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="At least one active administrator must remain",
            )
        if user.is_super_admin:
            super_admin_count = await _count_super_admin_users(db)
            if super_admin_count <= 1:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="At least one active super administrator must remain",
                )

    deleted_user_payload = {
        "user_id": int(user.id),
        "username": user.username,
        "role": user.role.value,
        "is_super_admin": bool(user.is_super_admin),
    }
    await db.delete(user)
    await db.commit()
    await create_audit_log(
        db,
        scope="admin",
        action="internal_user_deleted",
        actor=str(getattr(current_user, "username", "") or "admin"),
        entity_type="user",
        entity_id=deleted_user_payload["user_id"],
        title="内部账户已删除",
        summary=f"{deleted_user_payload['username']} ({deleted_user_payload['role']})",
        detail=deleted_user_payload,
    )
    await db.commit()
    return {"success": True, "message": "Internal user deleted successfully"}


@router.put("/me/profile", response_model=schemas.Token)
async def update_my_profile(
    payload: schemas.SelfProfileUpdateRequest,
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update current user's own profile and refresh token if username changes."""
    username = payload.username.strip()
    if not username:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username is required",
        )

    if username != current_user.username:
        result = await db.execute(
            select(models.User).where(models.User.username == username)
        )
        existing_user = result.scalar_one_or_none()
        if existing_user and existing_user.id != current_user.id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Username already registered",
            )
        current_user.username = username
        await db.commit()
        await db.refresh(current_user)

    access_token = create_access_token(
        data={"sub": current_user.username, "role": current_user.role.value}
    )
    return {"access_token": access_token, "token_type": "bearer", "user": current_user}


@router.put("/me/password")
async def update_my_password(
    payload: schemas.SelfPasswordUpdateRequest,
    current_user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Update current user's own password."""
    if payload.new_password != payload.confirm_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="New password confirmation does not match",
        )
    new_password = payload.new_password.strip()
    if len(new_password) < 6:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="New password must be at least 6 characters",
        )

    current_user.hashed_password = get_password_hash(new_password)
    if current_user.role in INTERNAL_USER_ROLES:
        current_user.plain_password = None
    await db.commit()

    return {"success": True, "message": "Password updated successfully"}
