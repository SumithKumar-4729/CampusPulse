from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from datetime import datetime, timedelta
import re
from zoneinfo import ZoneInfo
from ..database import get_db
from .. import models
from .. import schemas
from ..security import get_current_user
from ..utils.location_utils import calculate_distance

router = APIRouter()

# Mobile GPS can drift indoors; allow a small buffer to reduce false rejections.
GPS_TOLERANCE_METERS = 15.0


def _normalize_bssid(value: str) -> str:
    compact = re.sub(r"[^0-9a-fA-F]", "", str(value or ""))
    if len(compact) != 12:
        raise HTTPException(status_code=400, detail="BSSID must be a valid MAC address")
    compact = compact.upper()
    return ":".join(compact[i:i + 2] for i in range(0, 12, 2))


def _to_ist(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=ZoneInfo("Asia/Kolkata"))
    return dt.astimezone(ZoneInfo("Asia/Kolkata"))


def _session_window_bounds_ist(session: models.ClassSession, fallback_date):
    if session.class_start_time is None or session.attendance_window is None:
        return None, None

    session_date = session.session_date or fallback_date
    start_dt = datetime.combine(session_date, session.class_start_time, tzinfo=ZoneInfo("Asia/Kolkata"))
    end_dt = start_dt + timedelta(minutes=session.attendance_window)

    if session.class_end_time is not None:
        class_end_dt = datetime.combine(session_date, session.class_end_time, tzinfo=ZoneInfo("Asia/Kolkata"))
        if class_end_dt >= start_dt and class_end_dt < end_dt:
            end_dt = class_end_dt

    return start_dt, end_dt


@router.get("/attendance", response_model=list[schemas.AttendanceOut])
def list_attendance(
    user_id: int | None = None,
    classroom_id: int | None = None,
    session_id: int | None = None,
    status: str | None = None,
    db: Session = Depends(get_db),
):
    query = db.query(models.Attendance)
    if user_id is not None:
        query = query.filter(models.Attendance.user_id == user_id)
    if session_id is not None:
        query = query.filter(models.Attendance.class_session_id == session_id)
    if classroom_id is not None:
        query = query.filter(models.Attendance.classroom_id == classroom_id)
    if status:
        query = query.filter(models.Attendance.status == status)
    return query.order_by(models.Attendance.id.desc()).all()

@router.post("/attendance", response_model=schemas.AttendanceOut)
def mark_attendance(
    attendance: schemas.AttendanceCreate,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):

    existing_request = db.query(models.Attendance).filter(
        models.Attendance.request_id == attendance.request_id,
    ).first()
    if existing_request:
        return existing_request

    if current_user.id != attendance.user_id:
        raise HTTPException(status_code=403, detail="Token user does not match attendance user")

    user = db.query(models.User).filter(models.User.id == attendance.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    ist_now = datetime.now(ZoneInfo("Asia/Kolkata"))

    session = None
    if attendance.class_session_id is not None:
        session = db.query(models.ClassSession).filter(models.ClassSession.id == attendance.class_session_id).first()
        if not session:
            raise HTTPException(status_code=404, detail="Class session not found")
        if session.classroom_id != attendance.classroom_id:
            raise HTTPException(status_code=400, detail="Class session does not belong to the selected classroom")
    else:
        active_sessions = db.query(models.ClassSession).filter(
            models.ClassSession.classroom_id == attendance.classroom_id,
            models.ClassSession.session_date == ist_now.date(),
        ).order_by(models.ClassSession.class_start_time.desc()).all()

        for candidate in active_sessions:
            start_dt, end_dt = _session_window_bounds_ist(candidate, ist_now.date())
            if start_dt is None or end_dt is None:
                continue
            if start_dt <= ist_now <= end_dt:
                session = candidate
                break

    if session is None:
        raise HTTPException(status_code=400, detail="No active class session found for this classroom")

    enrollment = db.query(models.Enrollment).filter(
        models.Enrollment.user_id == attendance.user_id,
        models.Enrollment.classroom_id == attendance.classroom_id,
        (models.Enrollment.class_session_id == session.id) | (models.Enrollment.class_session_id.is_(None)),
    ).first()
    if not enrollment:
        raise HTTPException(status_code=403, detail="Student is not assigned to this classroom")

    classroom = db.query(models.Classroom).filter(models.Classroom.id == attendance.classroom_id).first()
    if not classroom:
        raise HTTPException(status_code=404, detail="Classroom not found")

    normalized_bssid = _normalize_bssid(attendance.bssid)
    classroom_bssids = db.query(models.WiFiBSSID).filter(
        models.WiFiBSSID.classroom_id == attendance.classroom_id,
    ).all()
    matched_router = next(
        (row for row in classroom_bssids if _normalize_bssid(row.bssid) == normalized_bssid),
        None,
    )

    if not matched_router:
        raise HTTPException(
            status_code=403,
            detail="Invalid WiFi router. Register both 2.4 GHz and 5 GHz BSSIDs for this classroom.",
        )

    distance = calculate_distance(attendance.latitude, attendance.longitude, classroom.latitude, classroom.longitude)
    allowed_radius = float(classroom.radius or 0) + GPS_TOLERANCE_METERS
    if distance > allowed_radius:
        raise HTTPException(
            status_code=403,
            detail=(
                "User is outside the classroom radius "
                f"(distance={distance:.1f}m, configured_radius={float(classroom.radius or 0):.1f}m, "
                f"gps_tolerance={GPS_TOLERANCE_METERS:.1f}m)."
            ),
        )

    class_start_dt, attendance_end_dt = _session_window_bounds_ist(session, ist_now.date())
    if class_start_dt is None or attendance_end_dt is None:
        raise HTTPException(status_code=400, detail="Class session timing is not configured")

    if not (class_start_dt <= ist_now <= attendance_end_dt):
        raise HTTPException(status_code=403, detail="Attendance is outside the allowed time window")
    
    existing_attendance = db.query(models.Attendance).filter(
        models.Attendance.user_id == attendance.user_id,
        models.Attendance.classroom_id == attendance.classroom_id,
        models.Attendance.class_session_id == session.id,
    ).first()

    if existing_attendance:
        raise HTTPException(
            status_code=409,
            detail="Attendance already marked"
        )

    biometric_verified_at = attendance.biometric_verified_at or ist_now

    attendance = models.Attendance(
        user_id=attendance.user_id,
        classroom_id=attendance.classroom_id,
        class_session_id=session.id,
        timestamp=ist_now,
        status="present",
        biometric_verified_at=biometric_verified_at,
        request_id=attendance.request_id,
    )

    db.add(attendance)
    db.commit()
    db.refresh(attendance)

    return attendance


@router.patch("/attendance/{attendance_id}/correct", response_model=schemas.AttendanceOut)
def correct_attendance(
    attendance_id: int,
    payload: schemas.AttendanceCorrectionRequest,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if str(current_user.role or "").lower() != "admin":
        raise HTTPException(status_code=403, detail="Only admins can correct attendance")

    row = db.query(models.Attendance).filter(models.Attendance.id == attendance_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Attendance record not found")

    now_ist = datetime.now(ZoneInfo("Asia/Kolkata"))
    marked_at_ist = _to_ist(row.timestamp)
    age = now_ist - marked_at_ist
    if age > timedelta(days=7):
        raise HTTPException(status_code=403, detail="Attendance can only be corrected within 7 days")

    status_value = str(payload.status or "").strip().lower()
    if status_value not in {"present", "absent"}:
        raise HTTPException(status_code=400, detail="Status must be present or absent")

    row.status = status_value
    row.correction_reason = payload.reason.strip()
    row.corrected_by = current_user.id
    row.corrected_at = now_ist

    db.commit()
    db.refresh(row)
    return row