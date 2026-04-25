# Android Frontend Development with Copilot - Prompts

Your backend runs at: `http://localhost:8000` (or your deployed server URL)

## Backend API Summary
- **Title**: Geo-Location Attendance System
- **Description**: Attendance system using GPS and WiFi BSSID validation
- **Tech Stack**: FastAPI, SQLAlchemy, PostgreSQL

### Available Endpoints:
```
POST   /users/register       - User registration
POST   /users/login          - User login
GET    /classrooms           - List all classrooms
POST   /attendance           - Mark attendance for a classroom session
GET    /wifi/nearby          - Get nearby WiFi networks
```

## Copilot Prompts for Android Frontend

### Prompt 1: Project Setup & Dependencies
```
Create an Android app in Kotlin with these dependencies:
- Retrofit2 for HTTP requests
- OkHttp for interceptors (add auth headers)
- Room database for local caching
- Coroutines for async operations
- Android Location Services for GPS
- Navigation Component for routing between screens

Backend API base URL: http://YOUR_API_URL:8000
```

### Prompt 2: Authentication Module
```
Create a Kotlin authentication system for Android that:
1. Stores JWT tokens in encrypted SharedPreferences (use EncryptedSharedPreferences)
2. Has login/registration screen with email & password validation
3. Automatically attaches Bearer token to all API requests
4. Handles token refresh and logout
5. Backend endpoint: POST /users/login and POST /users/register

Include:
- LoginViewModel using MVI/MVVM pattern
- AuthInterceptor for OkHttp
- Secure token storage
```

### Prompt 3: Classroom List & Location Tracking
```
Create screens for:
1. ClassroomListScreen - Shows classrooms with GPS distance
2. ClassroomDetailScreen - Shows classroom details, WiFi networks, mark-attendance button
3. AttendanceSubmissionScreen - GPS + WiFi BSSID validation before attendance submission

Include:
- LocationManager to get current GPS coordinates
- Retrofit API calls to fetch classrooms and submit attendance
- Error handling for location permission
- Show distance from current location to each classroom
- Validate WiFi BSSID matches before allowing attendance submission
```

### Prompt 4: WiFi Network Detection
```
Create a WiFi network scanner that:
1. Gets nearby WiFi networks using WifiManager
2. Extracts BSSID and signal strength
3. Sends WiFi data to backend for validation
4. Shows which WiFi network is valid for the classroom

Include permissions handling for:
- ACCESS_FINE_LOCATION
- ACCESS_COARSE_LOCATION
- ACCESS_WIFI_STATE
- CHANGE_WIFI_STATE
```

### Prompt 5: Complete App Navigation
```
Create navigation flow:
1. SplashScreen (check if user logged in)
2. LoginScreen → RegisterScreen
3. ClassroomListScreen → ClassroomDetailScreen → AttendanceSubmissionScreen
4. AttendanceHistoryScreen
5. SettingsScreen (logout, profile)

Use Android Navigation Component with type-safe navigation
Implement bottom navigation for main sections
```

## How to Use These Prompts

### In Android Studio:
1. Press `Cmd+I` (Mac) or `Ctrl+I` (Windows/Linux) to open Copilot Chat
2. Copy one of the prompts above
3. Paste it into the chat
4. Copilot will generate code samples
5. Accept suggestions with `Tab` and refine as needed

### Alternative: Tell Copilot the Whole Story
```
I'm building an Android app for a Geo-Location Attendance System.
The backend is a FastAPI app at http://localhost:8000.
Key features:
- User authentication with JWT
- View list of classrooms with GPS distance
- Submit classroom attendance using GPS + WiFi BSSID
- View attendance history

Build me:
1. Complete project structure
2. Retrofit API client setup
3. Authentication system (login/register)
4. Location & WiFi detection
5. Attendance submission flow
6. Navigation between screens

Use Kotlin, MVVM pattern, Coroutines, and modern Android best practices.
```

## Tips for Working with Copilot

✅ **Do:**
- Ask Copilot to generate **complete features** (not just snippets)
- Request **error handling** and **permission management** explicitly
- Ask for **tests** while building
- Request **code comments** for complex logic

❌ **Don't:**
- Ask for deprecated Android APIs (Copilot might suggest old code)
- Skip permission handling - always ask Copilot how to request permissions
- Build without testing location/WiFi features on a real device

## Quick API Integration Pattern

```kotlin
// Copilot suggestion example - you'll request this
interface AttendanceApiService {
    @POST("/users/login")
    suspend fun login(@Body request: LoginRequest): LoginResponse
    
    @GET("/classrooms")
    suspend fun getClassrooms(): List<Classroom>
    
    @POST("/attendance")
    suspend fun submitAttendance(@Body request: AttendanceRequest): AttendanceResponse
}
```

Once you get Copilot code, ask follow-up questions like:
- "How do I handle errors from this API?"
- "Add error handling for network failures"
- "Add retry logic with exponential backoff"
- "Create a test for this function"
