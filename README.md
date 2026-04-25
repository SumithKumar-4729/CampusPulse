# CampusPulse - Smart Attendance System

CampusPulse is a secure, automated attendance management system that uses multi-layered validation (Biometrics, Geolocation, and WiFi BSSID) to ensure integrity in student attendance marking.

## 🚀 Key Features

- **Multi-Factor Validation**: Combines GPS location, WiFi Access Point (BSSID) matching, and Biometric (Face/Fingerprint) authentication.
- **Android Mobile App**: A modern Jetpack Compose app for students to mark attendance seamlessly.
- **Admin Dashboard**: A web-based frontend for faculty to manage classrooms, view student analytics, and handle manual overrides.
- **Secure Backend**: FastAPI-powered REST API with JWT authentication and PostgreSQL storage.

## 🛠️ Tech Stack

- **Android**: Kotlin, Jetpack Compose, Biometric API, Retrofit, Coroutines.
- **Backend**: Python, FastAPI, SQLAlchemy, PostgreSQL.
- **Admin Frontend**: HTML5, CSS3, Vanilla JavaScript.
- **Network**: ADB Reverse tunneling for seamless local development.

## 📁 Project Structure

```text
CampusPulse/
└── Code/
    ├── CampusPulse/          # Android App (Kotlin/Jetpack Compose)
    ├── backend/              # FastAPI Python Backend
    ├── admin-frontend/       # Web Dashboard for Admins
    ├── requirements.txt      # Python dependencies
    └── startup.sh            # Script to run the backend
```

## ⚙️ Setup Instructions

### Backend
1. Ensure you have Python 3.10+ installed.
2. Navigate to the Code folder: `cd Code`
3. Install dependencies: `pip install -r requirements.txt`
4. Run the backend: `./startup.sh`

### Android App
1. Open the `Code/CampusPulse` folder in Android Studio.
2. Build and run on a physical device or emulator.
3. For physical device testing, use `adb reverse tcp:8000 tcp:8000` to connect to the local backend.

### Admin Frontend
1. Simply open `admin-frontend/index.html` in any modern web browser.
2. Log in with admin credentials to manage data.

## 🔒 Security
- **Biometrics**: Optimized Face ID flow (zero-click confirmation).
- **Anti-Spoofing**: Validates that the student is physically within the classroom radius and connected to the specific classroom WiFi.
