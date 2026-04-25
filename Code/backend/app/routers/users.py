from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..database import get_db
from .. import models
from .. import schemas
from ..security import create_access_token, get_current_user, hash_password, verify_password

router = APIRouter()


@router.get("/users", response_model=list[schemas.UserOut])
def list_users(role: str | None = None, db: Session = Depends(get_db)):
    query = db.query(models.User)
    if role:
        query = query.filter(models.User.role == role)
    return query.order_by(models.User.id.desc()).all()

@router.post("/users", response_model=schemas.UserOut)
def create_user(
    user: schemas.UserCreate,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if str(current_user.role or "").lower() != "admin":
        raise HTTPException(status_code=403, detail="Only admins can create accounts")

    existing_user = db.query(models.User).filter(models.User.email == user.email).first()
    if existing_user:
        raise HTTPException(status_code=409, detail="Email already registered")

    new_user = models.User(
        name=user.name,
        email=user.email,
        password_hash=hash_password(user.password),
        role=user.role,
    )

    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    return new_user


@router.post("/users/login", response_model=schemas.LoginOut)
def login_user(
    credentials: schemas.LoginRequest,
    db: Session = Depends(get_db),
):

    user = db.query(models.User).filter(models.User.email == credentials.email).first()
    if not user or not verify_password(credentials.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    token = create_access_token(user)
    return schemas.LoginOut(
        access_token=token,
        token=token,
        token_type="bearer",
        user_id=user.id,
        user=user,
    )


@router.patch("/users/{user_id}/password", response_model=schemas.UserOut)
def admin_set_user_password(
    user_id: int,
    payload: schemas.AdminSetPasswordRequest,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if str(current_user.role or "").lower() != "admin":
        raise HTTPException(status_code=403, detail="Only admins can set passwords")

    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.password_hash = hash_password(payload.password)
    db.commit()
    db.refresh(user)
    return user


