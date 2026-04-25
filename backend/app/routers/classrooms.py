from datetime import datetime, timedelta
from sqlalchemy import or_
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from ..database import get_db
from .. import models
from .. import schemas
from ..security import get_current_user

router = APIRouter()


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


@router.get("/classrooms", response_model=list[schemas.ClassroomOut])
def list_classrooms(db: Session = Depends(get_db)):
    return db.query(models.Classroom).order_by(models.Classroom.id.desc()).all()


@router.get("/classrooms/today", response_model=list[schemas.TodayClassOut])
def list_today_classes(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ist_now = datetime.now(ZoneInfo("Asia/Kolkata"))
    sessions_query = db.query(
        models.ClassSession,
        models.Classroom.name.label("classroom_name"),
    ).join(
        models.Classroom,
        models.Classroom.id == models.ClassSession.classroom_id,
    )

    if str(current_user.role or "").lower() == "student":
        session_assignment = db.query(models.Enrollment.id).filter(
            models.Enrollment.user_id == current_user.id,
            models.Enrollment.class_session_id == models.ClassSession.id,
        ).exists()
        classroom_assignment = db.query(models.Enrollment.id).filter(
            models.Enrollment.user_id == current_user.id,
            models.Enrollment.classroom_id == models.ClassSession.classroom_id,
            models.Enrollment.class_session_id.is_(None),
        ).exists()
        sessions_query = sessions_query.filter(or_(session_assignment, classroom_assignment))

    sessions = sessions_query.order_by(
        models.ClassSession.session_date.desc(),
        models.ClassSession.class_start_time.asc(),
        models.ClassSession.id.desc(),
    ).all()
    items: list[schemas.TodayClassOut] = []

    for session, classroom_name in sessions:
        window_start_ist: str | None = None
        window_end_ist: str | None = None
        is_markable_now = False
        status_note: str | None = None

        start_dt, end_dt = _session_window_bounds_ist(session, ist_now.date())

        if start_dt is None or end_dt is None:
            status_note = "Timing not configured"
        else:
            window_start_ist = start_dt.strftime("%H:%M:%S IST")
            window_end_ist = end_dt.strftime("%H:%M:%S IST")
            is_markable_now = session.session_date == ist_now.date() and start_dt <= ist_now <= end_dt
            if not is_markable_now:
                status_note = "Outside attendance window"

        items.append(
            schemas.TodayClassOut(
                session_id=session.id,
                classroom_name=classroom_name,
                title=session.title,
                session_date=session.session_date,
                classroom_id=session.classroom_id,
                name=session.title,
                class_start_time=session.class_start_time,
                class_end_time=session.class_end_time,
                attendance_window=session.attendance_window,
                window_start_ist=window_start_ist,
                window_end_ist=window_end_ist,
                is_markable_now=is_markable_now,
                status_note=status_note,
            ),
        )

    return items


@router.get("/class-sessions", response_model=list[schemas.ClassSessionOut])
def list_class_sessions(db: Session = Depends(get_db)):
    return db.query(models.ClassSession).order_by(models.ClassSession.id.desc()).all()


@router.post("/class-sessions", response_model=schemas.ClassSessionOut)
def create_class_session(
    payload: schemas.ClassSessionCreate,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if str(current_user.role or "").lower() != "admin":
        raise HTTPException(status_code=403, detail="Only admins can create class sessions")

    classroom = db.query(models.Classroom).filter(models.Classroom.id == payload.classroom_id).first()
    if not classroom:
        raise HTTPException(status_code=404, detail="Classroom not found")

    if payload.class_end_time <= payload.class_start_time:
        raise HTTPException(status_code=400, detail="Class end time must be later than start time")

    session = models.ClassSession(
        classroom_id=payload.classroom_id,
        title=payload.title,
        faculty=payload.faculty,
        session_date=payload.session_date,
        class_start_time=payload.class_start_time,
        class_end_time=payload.class_end_time,
        attendance_window=payload.attendance_window,
        created_by=current_user.id,
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


@router.patch("/class-sessions/{session_id}", response_model=schemas.ClassSessionOut)
def update_class_session(
    session_id: int,
    payload: schemas.ClassSessionUpdate,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if str(current_user.role or "").lower() != "admin":
        raise HTTPException(status_code=403, detail="Only admins can update class sessions")

    session = db.query(models.ClassSession).filter(models.ClassSession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Class session not found")

    if payload.classroom_id is not None:
        classroom = db.query(models.Classroom).filter(models.Classroom.id == payload.classroom_id).first()
        if not classroom:
            raise HTTPException(status_code=404, detail="Classroom not found")

    new_classroom_id = payload.classroom_id if payload.classroom_id is not None else session.classroom_id
    new_start = payload.class_start_time if payload.class_start_time is not None else session.class_start_time
    new_end = payload.class_end_time if payload.class_end_time is not None else session.class_end_time

    if new_start is None or new_end is None:
        raise HTTPException(status_code=400, detail="Class start time and end time are required")
    if new_end <= new_start:
        raise HTTPException(status_code=400, detail="Class end time must be later than start time")

    if payload.title is not None:
        session.title = payload.title
    if payload.faculty is not None:
        session.faculty = payload.faculty
    if payload.classroom_id is not None:
        session.classroom_id = payload.classroom_id
    if payload.session_date is not None:
        session.session_date = payload.session_date
    if payload.class_start_time is not None:
        session.class_start_time = payload.class_start_time
    if payload.class_end_time is not None:
        session.class_end_time = payload.class_end_time
    if payload.attendance_window is not None:
        session.attendance_window = payload.attendance_window

    db.query(models.Enrollment).filter(
        models.Enrollment.class_session_id == session.id,
    ).update(
        {models.Enrollment.classroom_id: new_classroom_id},
        synchronize_session=False,
    )

    db.query(models.Attendance).filter(
        models.Attendance.class_session_id == session.id,
    ).update(
        {models.Attendance.classroom_id: new_classroom_id},
        synchronize_session=False,
    )

    db.commit()
    db.refresh(session)
    return session


@router.post("/enrollments", response_model=schemas.EnrollmentOut)
def create_enrollment(
    payload: schemas.EnrollmentCreate,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if str(current_user.role or "").lower() != "admin":
        raise HTTPException(status_code=403, detail="Only admins can assign students to classrooms")

    user = db.query(models.User).filter(models.User.id == payload.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Student not found")
    if str(user.role or "").lower() != "student":
        raise HTTPException(status_code=400, detail="Only student users can be enrolled")

    classroom = db.query(models.Classroom).filter(models.Classroom.id == payload.classroom_id).first()
    if not classroom:
        raise HTTPException(status_code=404, detail="Classroom not found")

    session = None
    if payload.class_session_id is not None:
        session = db.query(models.ClassSession).filter(models.ClassSession.id == payload.class_session_id).first()
        if not session:
            raise HTTPException(status_code=404, detail="Class session not found")
        if session.classroom_id != payload.classroom_id:
            raise HTTPException(status_code=400, detail="Class session does not belong to the selected classroom")

    existing = db.query(models.Enrollment).filter(
        models.Enrollment.user_id == payload.user_id,
        models.Enrollment.classroom_id == payload.classroom_id,
        models.Enrollment.class_session_id == payload.class_session_id,
    ).first()
    if existing:
        return existing

    enrollment = models.Enrollment(
        user_id=payload.user_id,
        classroom_id=payload.classroom_id,
        class_session_id=payload.class_session_id,
        assigned_by=current_user.id,
    )
    db.add(enrollment)
    db.commit()
    db.refresh(enrollment)
    return enrollment


@router.get("/enrollments", response_model=list[schemas.EnrollmentOut])
def list_enrollments(
    user_id: int | None = None,
    classroom_id: int | None = None,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = db.query(models.Enrollment)

    if str(current_user.role or "").lower() == "student":
        query = query.filter(models.Enrollment.user_id == current_user.id)
    else:
        if user_id is not None:
            query = query.filter(models.Enrollment.user_id == user_id)
        if classroom_id is not None:
            query = query.filter(models.Enrollment.classroom_id == classroom_id)

    return query.order_by(models.Enrollment.id.desc()).all()


@router.delete("/enrollments/{enrollment_id}")
def delete_enrollment(
    enrollment_id: int,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if str(current_user.role or "").lower() != "admin":
        raise HTTPException(status_code=403, detail="Only admins can remove enrollments")

    enrollment = db.query(models.Enrollment).filter(models.Enrollment.id == enrollment_id).first()
    if not enrollment:
        raise HTTPException(status_code=404, detail="Enrollment not found")

    db.delete(enrollment)
    db.commit()
    return {"detail": "Enrollment removed"}

@router.post("/classrooms", response_model=schemas.ClassroomOut)
def create_classroom(
    classroom: schemas.ClassroomCreate,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if str(current_user.role or "").lower() != "admin":
        raise HTTPException(status_code=403, detail="Only admins can create classrooms")

    existing = db.query(models.Classroom).filter(models.Classroom.name == classroom.name).first()
    if existing:
        raise HTTPException(status_code=409, detail="Classroom name already exists")

    new_classroom = models.Classroom(
        name=classroom.name,
        latitude=classroom.latitude,
        longitude=classroom.longitude,
        radius=classroom.radius,
    )

    db.add(new_classroom)
    db.commit()
    db.refresh(new_classroom)

    return new_classroom


@router.patch("/classrooms/{classroom_id}", response_model=schemas.ClassroomOut)
def update_classroom(
    classroom_id: int,
    payload: schemas.ClassroomUpdate,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if str(current_user.role or "").lower() != "admin":
        raise HTTPException(status_code=403, detail="Only admins can update classrooms")

    classroom = db.query(models.Classroom).filter(models.Classroom.id == classroom_id).first()
    if not classroom:
        raise HTTPException(status_code=404, detail="Classroom not found")

    if payload.name is not None:
        existing = db.query(models.Classroom).filter(
            models.Classroom.name == payload.name,
            models.Classroom.id != classroom_id,
        ).first()
        if existing:
            raise HTTPException(status_code=409, detail="Classroom name already exists")
        classroom.name = payload.name

    if payload.latitude is not None:
        classroom.latitude = payload.latitude
    if payload.longitude is not None:
        classroom.longitude = payload.longitude
    if payload.radius is not None:
        classroom.radius = payload.radius

    db.commit()
    db.refresh(classroom)
    return classroom