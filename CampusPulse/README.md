# CampusPulse Android App (Sprint 1)

Student attendance Android app for the GeoAttendance project.

Minimum supported Android version: Android 11 (API 30).

## Implemented in Sprint 1

- Student-only login via backend `POST /users/login`
- Biometric/device-credential gate before app usage
- Biometric check again before attendance action
- Home screen with connected BSSID display and refresh
- BSSID-based proximity verification: Attendance is strictly tied to the classroom's registered BSSID; if the BSSID changes or doesn't match, attendance will not be marked.
- No biometric data storage (uses Android system prompt callbacks only)
- Strict biometric mode (face/fingerprint) is used when biometric auth is available
- Compatibility mode fallback uses device screen lock only when biometric auth is unavailable
- If both face and fingerprint are available, user can choose preferred method in app UI
- Location permission is requested/used only from foreground app actions (BSSID refresh/attendance flow)

## Current Scope

This sprint focuses on app shell + security entry flow.
Attendance submission API integration is planned next.

## Backend URL for USB Debug

The app uses `BuildConfig.API_BASE_URL` set to:

- `http://127.0.0.1:8000/`

For a real device over USB, use ADB reverse:

```bash
adb reverse tcp:8000 tcp:8000
```

## Run (from project root)

```bash
cd /mnt/data/WifiBSSID/Codes/CampusPulse
./gradlew --no-daemon :app:installDebug
```

## Open on device

```bash
adb shell am start -n com.example.campuspulse/.MainActivity
```

## Next Sprint

- Fetch today's classes (`GET /classrooms/today`)
- Build attendance payload (`user_id`, `classroom_id`, `bssid`, `latitude`, `longitude`, `request_id`)
- Submit attendance (`POST /attendance`) with role-safe token usage

