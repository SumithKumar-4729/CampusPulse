from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
import re
from ..database import get_db
from .. import models
from .. import schemas
from ..security import get_current_user

router = APIRouter()


def _normalize_bssid(value: str) -> str:
    # Keep only hex characters and canonicalize to AA:BB:CC:DD:EE:FF
    compact = re.sub(r"[^0-9a-fA-F]", "", str(value or ""))
    if len(compact) != 12:
        raise HTTPException(status_code=400, detail="BSSID must be a valid MAC address")
    compact = compact.upper()
    return ":".join(compact[i:i + 2] for i in range(0, 12, 2))


@router.get("/wifi", response_model=list[schemas.WiFiBSSIDOut])
def list_bssids(classroom_id: int | None = None, db: Session = Depends(get_db)):
    query = db.query(models.WiFiBSSID)
    if classroom_id is not None:
        query = query.filter(models.WiFiBSSID.classroom_id == classroom_id)
    return query.order_by(models.WiFiBSSID.id.desc()).all()

@router.post("/wifi", response_model=schemas.WiFiBSSIDOut)
def add_bssid(
    payload: schemas.WiFiBSSIDCreate,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if str(current_user.role or "").lower() != "admin":
        raise HTTPException(status_code=403, detail="Only admins can register WiFi BSSIDs")

    normalized_bssid = _normalize_bssid(payload.bssid)

    classroom = db.query(models.Classroom).filter(models.Classroom.id == payload.classroom_id).first()
    if not classroom:
        raise HTTPException(status_code=404, detail="Classroom not found")

    existing = db.query(models.WiFiBSSID).filter(
        models.WiFiBSSID.classroom_id == payload.classroom_id,
        models.WiFiBSSID.bssid == normalized_bssid,
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="BSSID already registered for this classroom")

    wifi_bssid = models.WiFiBSSID(
        classroom_id=payload.classroom_id,
        bssid=normalized_bssid,
    )

    db.add(wifi_bssid)
    db.commit()
    db.refresh(wifi_bssid)

    return wifi_bssid