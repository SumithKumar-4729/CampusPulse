from contextlib import asynccontextmanager
import os
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from sqlalchemy import inspect, text
from .database import engine
from . import models
from .routers import users
from .routers import classrooms
from .routers import wifi
from .routers import attendance


def _parse_cors_origins() -> list[str]:
    configured = os.getenv("CORS_ALLOW_ORIGINS", "")
    if configured.strip():
        return [origin.strip() for origin in configured.split(",") if origin.strip()]

    return [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
    ]


def _sync_classroom_columns() -> None:
    return


def _sync_class_session_columns() -> None:
    inspector = inspect(engine)
    if "class_sessions" not in inspector.get_table_names():
        return

    existing_columns = {column["name"] for column in inspector.get_columns("class_sessions")}
    with engine.begin() as connection:
        if "title" not in existing_columns:
            connection.execute(text("ALTER TABLE class_sessions ADD COLUMN title VARCHAR"))
        if "faculty" not in existing_columns:
            connection.execute(text("ALTER TABLE class_sessions ADD COLUMN faculty VARCHAR"))
        if "session_date" not in existing_columns:
            connection.execute(text("ALTER TABLE class_sessions ADD COLUMN session_date DATE"))
        if "class_start_time" not in existing_columns:
            connection.execute(text("ALTER TABLE class_sessions ADD COLUMN class_start_time TIME"))
        if "class_end_time" not in existing_columns:
            connection.execute(text("ALTER TABLE class_sessions ADD COLUMN class_end_time TIME"))
        if "attendance_window" not in existing_columns:
            connection.execute(text("ALTER TABLE class_sessions ADD COLUMN attendance_window INTEGER"))
        if "created_by" not in existing_columns:
            connection.execute(text("ALTER TABLE class_sessions ADD COLUMN created_by INTEGER"))
        if "created_at" not in existing_columns:
            connection.execute(text("ALTER TABLE class_sessions ADD COLUMN created_at TIMESTAMP"))


def _sync_enrollment_columns() -> None:
    inspector = inspect(engine)
    if "enrollments" not in inspector.get_table_names():
        return

    existing_columns = {column["name"] for column in inspector.get_columns("enrollments")}
    with engine.begin() as connection:
        if "class_session_id" not in existing_columns:
            connection.execute(text("ALTER TABLE enrollments ADD COLUMN class_session_id INTEGER"))


def _sync_attendance_columns() -> None:
    inspector = inspect(engine)
    if "attendance" not in inspector.get_table_names():
        return

    existing_columns = {column["name"] for column in inspector.get_columns("attendance")}
    with engine.begin() as connection:
        if "biometric_verified_at" not in existing_columns:
            connection.execute(text("ALTER TABLE attendance ADD COLUMN biometric_verified_at TIMESTAMP"))
        if "request_id" not in existing_columns:
            connection.execute(text("ALTER TABLE attendance ADD COLUMN request_id VARCHAR"))
        if "class_session_id" not in existing_columns:
            connection.execute(text("ALTER TABLE attendance ADD COLUMN class_session_id INTEGER"))
        if "correction_reason" not in existing_columns:
            connection.execute(text("ALTER TABLE attendance ADD COLUMN correction_reason VARCHAR"))
        if "corrected_by" not in existing_columns:
            connection.execute(text("ALTER TABLE attendance ADD COLUMN corrected_by INTEGER"))
        if "corrected_at" not in existing_columns:
            connection.execute(text("ALTER TABLE attendance ADD COLUMN corrected_at TIMESTAMP"))

@asynccontextmanager
async def lifespan(app: FastAPI):
    models.Base.metadata.create_all(bind=engine)
    _sync_classroom_columns()
    _sync_class_session_columns()
    _sync_enrollment_columns()
    _sync_attendance_columns()
    yield

app = FastAPI(
    title="Geo-Location Attendance System",
    description="Attendance system using GPS and WiFi BSSID validation",
    version="1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_parse_cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(users.router)
app.include_router(classrooms.router)
app.include_router(wifi.router)
app.include_router(attendance.router)

BASE_DIR = Path(__file__).resolve().parents[2]
ADMIN_FRONTEND_DIR = BASE_DIR / "admin-frontend"


@app.get("/admin", include_in_schema=False)
def admin_frontend_index():
    index_file = ADMIN_FRONTEND_DIR / "index.html"
    if not index_file.exists():
        return {"detail": "Admin frontend not found"}
    return FileResponse(index_file)


@app.get("/admin/{asset_path:path}", include_in_schema=False)
def admin_frontend_assets(asset_path: str):
    requested_file = ADMIN_FRONTEND_DIR / asset_path
    if requested_file.exists() and requested_file.is_file():
        return FileResponse(requested_file)

    index_file = ADMIN_FRONTEND_DIR / "index.html"
    if index_file.exists():
        return FileResponse(index_file)
    return {"detail": "Admin frontend not found"}


@app.get("/", include_in_schema=False)
def frontend_root():
    index_file = ADMIN_FRONTEND_DIR / "index.html"
    if not index_file.exists():
        return {"detail": "Admin frontend not found"}
    return FileResponse(index_file)


@app.get("/styles.css", include_in_schema=False)
def frontend_styles():
    css_file = ADMIN_FRONTEND_DIR / "styles.css"
    if not css_file.exists():
        return {"detail": "styles.css not found"}
    return FileResponse(css_file)


@app.get("/app.js", include_in_schema=False)
def frontend_script():
    script_file = ADMIN_FRONTEND_DIR / "app.js"
    if not script_file.exists():
        return {"detail": "app.js not found"}
    return FileResponse(script_file)


@app.get("/api/health")
def health():
    return {"message": "Geo Attendance Backend Running"}