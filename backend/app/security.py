from datetime import datetime, timedelta, timezone
import os

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from .database import get_db
from . import models

SECRET_KEY = os.getenv("JWT_SECRET_KEY", "change-me-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "10080"))

pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")
bearer_scheme = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
	return pwd_context.hash(password)


def is_hashed_password(value: str | None) -> bool:
	return bool(value) and pwd_context.identify(value) is not None


def verify_password(plain_password: str, stored_value: str | None) -> bool:
	if not stored_value:
		return False
	if is_hashed_password(stored_value):
		return pwd_context.verify(plain_password, stored_value)
	return plain_password == stored_value


def create_access_token(user: models.User) -> str:
	expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
	payload = {
		"sub": str(user.id),
		"user_id": user.id,
		"email": user.email,
		"role": user.role,
		"exp": expire,
	}
	return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def get_current_user(
	credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
	db: Session = Depends(get_db),
) -> models.User:
	if credentials is None or not credentials.credentials:
		raise HTTPException(
			status_code=status.HTTP_401_UNAUTHORIZED,
			detail="Authorization token missing",
			headers={"WWW-Authenticate": "Bearer"},
		)

	token = credentials.credentials
	try:
		payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
		user_id = payload.get("user_id") or payload.get("sub")
		if user_id is None:
			raise ValueError("missing user id")
	except (JWTError, ValueError):
		raise HTTPException(
			status_code=status.HTTP_401_UNAUTHORIZED,
			detail="Invalid or expired authorization token",
			headers={"WWW-Authenticate": "Bearer"},
		) from None

	user = db.query(models.User).filter(models.User.id == int(user_id)).first()
	if not user:
		raise HTTPException(
			status_code=status.HTTP_401_UNAUTHORIZED,
			detail="User not found",
			headers={"WWW-Authenticate": "Bearer"},
		)
	return user

