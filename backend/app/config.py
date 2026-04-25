import os

from dotenv import load_dotenv


load_dotenv()

DATABASE_URL = os.getenv(
	"DATABASE_URL",
	"postgresql://admin:admin123@localhost:5432/attendance_db",
)
