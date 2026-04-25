package com.example.campuspulse.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.example.campuspulse.data.model.UserDto
import com.example.campuspulse.data.model.ClassroomToday
import com.example.campuspulse.data.model.AttendanceRequest
import com.example.campuspulse.data.repository.AuthRepository
import com.example.campuspulse.data.repository.AttendanceRepository
import com.example.campuspulse.data.local.SessionManager
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.util.UUID

data class UserSession(
    val token: String,
    val user: UserDto,
)

data class AppUiState(
    val requiresAppUnlock: Boolean = true,
    val session: UserSession? = null,
    val todayClasses: List<ClassroomToday> = emptyList(),
    val isLoading: Boolean = false,
    val errorMessage: String? = null,
    val infoMessage: String? = null,
)

class AppViewModel(
    private val authRepository: AuthRepository,
    private val attendanceRepository: AttendanceRepository,
    private val sessionManager: SessionManager,
) : ViewModel() {
    private val _uiState = MutableStateFlow(AppUiState())
    val uiState: StateFlow<AppUiState> = _uiState.asStateFlow()

    init {
        val savedSession = sessionManager.getSession()
        if (savedSession != null) {
            _uiState.update { it.copy(session = savedSession) }
            fetchTodayClasses()
        }
    }

    fun unlockApp() {
        _uiState.update { it.copy(requiresAppUnlock = false, errorMessage = null) }
    }

    fun reportError(message: String) {
        _uiState.update { it.copy(errorMessage = message) }
    }

    fun clearMessages() {
        _uiState.update { it.copy(errorMessage = null, infoMessage = null) }
    }

    fun login(email: String, password: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, errorMessage = null, infoMessage = null) }
            val result = authRepository.login(email = email, password = password)

            result.onSuccess { payload ->
                if (payload.user.role.lowercase() != "student") {
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            errorMessage = "This app is only for student accounts.",
                        )
                    }
                    return@onSuccess
                }

                val session = UserSession(token = payload.access_token, user = payload.user)
                sessionManager.saveSession(session)

                _uiState.update {
                    it.copy(
                        isLoading = false,
                        session = session,
                        infoMessage = "Welcome ${payload.user.name}",
                        errorMessage = null,
                    )
                }
                fetchTodayClasses()
            }.onFailure { failure ->
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        errorMessage = failure.message ?: "Login failed",
                    )
                }
            }
        }
    }

    fun logout() {
        sessionManager.clearSession()
        _uiState.update {
            it.copy(
                session = null,
                todayClasses = emptyList(),
                infoMessage = "Logged out",
                errorMessage = null,
            )
        }
    }

    fun fetchTodayClasses() {
        val session = _uiState.value.session ?: return
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }
            attendanceRepository.getTodayClasses(session.token).onSuccess { classes ->
                _uiState.update { it.copy(isLoading = false, todayClasses = classes) }
            }.onFailure { failure ->
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        errorMessage = "Failed to fetch timetable: ${failure.message}"
                    )
                }
            }
        }
    }

    fun markAttendance(classroom: ClassroomToday, bssid: String, latitude: Double, longitude: Double) {
        val session = _uiState.value.session ?: return
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, errorMessage = null) }

            val request = AttendanceRequest(
                user_id = session.user.id,
                classroom_id = classroom.classroom_id,
                bssid = bssid,
                latitude = latitude,
                longitude = longitude,
                biometric_verified_at = ZonedDateTime.now().format(DateTimeFormatter.ISO_OFFSET_DATE_TIME),
                request_id = UUID.randomUUID().toString()
            )

            attendanceRepository.markAttendance(session.token, request).onSuccess {
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        infoMessage = "Attendance marked successfully for ${classroom.name}!"
                    )
                }
                fetchTodayClasses()
            }.onFailure { failure ->
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        errorMessage = failure.message
                    )
                }
            }
        }
    }

    fun onAttendanceBiometricVerified() {
        // This is handled in the UI by calling markAttendance with actual data
    }
}

class AppViewModelFactory(
    private val authRepository: AuthRepository,
    private val attendanceRepository: AttendanceRepository,
    private val sessionManager: SessionManager,
) : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        return AppViewModel(authRepository, attendanceRepository, sessionManager) as T
    }
}

