from sqlalchemy import Column, Integer, String, Float, ForeignKey, DateTime, Time, Date
from sqlalchemy.sql import func
from .database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String)
    email = Column(String, unique=True, index=True)
    password_hash = Column(String)
    role = Column(String)


class Classroom(Base):
    __tablename__ = "classrooms"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String)
    latitude = Column(Float)
    longitude = Column(Float)
    radius = Column(Float)


class ClassSession(Base):
    __tablename__ = "class_sessions"

    id = Column(Integer, primary_key=True, index=True)
    classroom_id = Column(Integer, ForeignKey("classrooms.id"), index=True)
    title = Column(String)
    faculty = Column(String)
    session_date = Column(Date, index=True)
    class_start_time = Column(Time)
    class_end_time = Column(Time)
    attendance_window = Column(Integer)
    created_by = Column(Integer, ForeignKey("users.id"))
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class WiFiBSSID(Base):
    __tablename__ = "wifi_bssid"

    id = Column(Integer, primary_key=True, index=True)
    classroom_id = Column(Integer, ForeignKey("classrooms.id"))
    bssid = Column(String)


class Attendance(Base):
    __tablename__ = "attendance"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    classroom_id = Column(Integer, ForeignKey("classrooms.id"))
    class_session_id = Column(Integer, ForeignKey("class_sessions.id"), index=True)
    timestamp = Column(DateTime(timezone=True), server_default=func.now())
    status = Column(String)
    biometric_verified_at = Column(DateTime(timezone=True))
    request_id = Column(String, unique=True, index=True)
    correction_reason = Column(String)
    corrected_by = Column(Integer, ForeignKey("users.id"))
    corrected_at = Column(DateTime(timezone=True))


class Enrollment(Base):
    __tablename__ = "enrollments"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True)
    classroom_id = Column(Integer, ForeignKey("classrooms.id"), index=True)
    class_session_id = Column(Integer, ForeignKey("class_sessions.id"), index=True)
    assigned_by = Column(Integer, ForeignKey("users.id"))
    assigned_at = Column(DateTime(timezone=True), server_default=func.now())