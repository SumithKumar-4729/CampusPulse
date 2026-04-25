from datetime import datetime, time, date
from pydantic import BaseModel, ConfigDict, Field


class UserCreate(BaseModel):
	name: str = Field(min_length=1, max_length=100)
	email: str
	password: str = Field(min_length=6)
	role: str = Field(default="student", min_length=1, max_length=50)


class UserOut(BaseModel):
	model_config = ConfigDict(from_attributes=True)

	id: int
	name: str
	email: str
	role: str


class LoginOut(BaseModel):
	model_config = ConfigDict(from_attributes=True)

	access_token: str
	token: str
	token_type: str = "bearer"
	user_id: int
	user: UserOut


class LoginRequest(BaseModel):
	email: str
	password: str = Field(min_length=6)


class AdminSetPasswordRequest(BaseModel):
	password: str = Field(min_length=6)


class ClassroomCreate(BaseModel):
	name: str = Field(min_length=1, max_length=150)
	latitude: float
	longitude: float
	radius: float = Field(gt=0)


class ClassroomUpdate(BaseModel):
	name: str | None = Field(default=None, min_length=1, max_length=150)
	latitude: float | None = None
	longitude: float | None = None
	radius: float | None = Field(default=None, gt=0)


class ClassroomOut(BaseModel):
	model_config = ConfigDict(from_attributes=True)

	id: int
	name: str
	latitude: float
	longitude: float
	radius: float


class ClassSessionCreate(BaseModel):
	title: str = Field(min_length=1, max_length=150)
	faculty: str = Field(min_length=1, max_length=150)
	classroom_id: int
	session_date: date
	class_start_time: time
	class_end_time: time
	attendance_window: int = Field(gt=0)


class ClassSessionUpdate(BaseModel):
	title: str | None = Field(default=None, min_length=1, max_length=150)
	faculty: str | None = Field(default=None, min_length=1, max_length=150)
	classroom_id: int | None = None
	session_date: date | None = None
	class_start_time: time | None = None
	class_end_time: time | None = None
	attendance_window: int | None = Field(default=None, gt=0)


class ClassSessionOut(BaseModel):
	model_config = ConfigDict(from_attributes=True)

	id: int
	classroom_id: int
	title: str
	faculty: str
	session_date: date
	class_start_time: time | None
	class_end_time: time | None
	attendance_window: int | None
	created_by: int | None = None
	created_at: datetime | None = None


class TodayClassOut(BaseModel):
	session_id: int | None = None
	classroom_name: str | None = None
	title: str | None = None
	session_date: date | None = None
	classroom_id: int
	name: str
	class_start_time: time | None
	class_end_time: time | None = None
	attendance_window: int | None
	window_start_ist: str | None
	window_end_ist: str | None
	is_markable_now: bool
	status_note: str | None = None


class WiFiBSSIDCreate(BaseModel):
	classroom_id: int
	bssid: str = Field(min_length=1, max_length=100)


class WiFiBSSIDOut(BaseModel):
	model_config = ConfigDict(from_attributes=True)

	id: int
	classroom_id: int
	bssid: str


class AttendanceCreate(BaseModel):
	user_id: int
	classroom_id: int
	class_session_id: int | None = None
	bssid: str = Field(min_length=1, max_length=100)
	latitude: float
	longitude: float
	biometric_verified_at: datetime | None = None
	request_id: str = Field(min_length=1, max_length=100)


class AttendanceOut(BaseModel):
	model_config = ConfigDict(from_attributes=True)

	id: int
	user_id: int
	classroom_id: int
	class_session_id: int | None = None
	timestamp: datetime
	status: str | None
	biometric_verified_at: datetime | None = None
	request_id: str | None = None
	correction_reason: str | None = None
	corrected_by: int | None = None
	corrected_at: datetime | None = None


class AttendanceCorrectionRequest(BaseModel):
	status: str = Field(min_length=1, max_length=20)
	reason: str = Field(min_length=3, max_length=500)


class EnrollmentCreate(BaseModel):
	user_id: int
	classroom_id: int
	class_session_id: int | None = None


class EnrollmentOut(BaseModel):
	model_config = ConfigDict(from_attributes=True)

	id: int
	user_id: int
	classroom_id: int
	class_session_id: int | None = None
	assigned_by: int | None = None
	assigned_at: datetime | None = None
