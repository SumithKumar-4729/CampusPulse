package com.example.campuspulse

import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.res.stringResource
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.viewmodel.compose.viewModel
import com.example.campuspulse.data.local.SessionManager
import com.example.campuspulse.data.network.NetworkModule
import com.example.campuspulse.data.repository.AuthRepository
import com.example.campuspulse.data.repository.AttendanceRepository
import com.example.campuspulse.security.AuthMode
import com.example.campuspulse.security.BiometricAuthenticator
import com.example.campuspulse.security.BiometricMethod
import com.example.campuspulse.ui.AppViewModel
import com.example.campuspulse.ui.AppViewModelFactory
import com.example.campuspulse.ui.screens.AppUnlockScreen
import com.example.campuspulse.ui.screens.HomeScreen
import com.example.campuspulse.ui.screens.LoginScreen
import com.example.campuspulse.ui.theme.CampusPulseTheme

class MainActivity : FragmentActivity() {
    private val biometricAuthenticator = BiometricAuthenticator()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            CampusPulseTheme {
                val appViewModel: AppViewModel = viewModel(
                    factory = AppViewModelFactory(
                        authRepository = AuthRepository(NetworkModule.authApiService),
                        attendanceRepository = AttendanceRepository(NetworkModule.attendanceApiService),
                        sessionManager = SessionManager(applicationContext)
                    ),
                )
                val uiState by appViewModel.uiState.collectAsState()
                val snackbarHostState = remember { SnackbarHostState() }

                LaunchedEffect(uiState.errorMessage) {
                    uiState.errorMessage?.let {
                        snackbarHostState.showSnackbar(it)
                        appViewModel.clearMessages()
                    }
                }

                LaunchedEffect(uiState.infoMessage) {
                    uiState.infoMessage?.let {
                        snackbarHostState.showSnackbar(it)
                        appViewModel.clearMessages()
                    }
                }

                Scaffold(
                    snackbarHost = { SnackbarHost(hostState = snackbarHostState) }
                ) { _ ->
                    AppRoot(
                        uiState = uiState,
                        appViewModel = appViewModel,
                        biometricAuthenticator = biometricAuthenticator,
                        onUnlockSuccess = { appViewModel.unlockApp() },
                        onUnlockFailure = { appViewModel.reportError(it) },
                        onLogin = { email, password -> appViewModel.login(email, password) },
                        onLogout = { appViewModel.logout() },
                        clearMessages = { appViewModel.clearMessages() },
                    )
                }
            }
        }
    }
}

@Composable
private fun AppRoot(
    uiState: com.example.campuspulse.ui.AppUiState,
    appViewModel: AppViewModel,
    biometricAuthenticator: BiometricAuthenticator,
    onUnlockSuccess: () -> Unit,
    onUnlockFailure: (String) -> Unit,
    onLogin: (String, String) -> Unit,
    onLogout: () -> Unit,
    clearMessages: () -> Unit,
) {
    val activity = androidx.compose.ui.platform.LocalContext.current as FragmentActivity
    val availability = biometricAuthenticator.availability(activity)
    val canAuthenticate = availability.canAuthenticate
    val supportedMethods = availability.supportedMethods
    val authMode = availability.authMode
    val allowMethodSelection = authMode == AuthMode.BIOMETRIC_STRICT && supportedMethods.size > 1
    val availabilityStatusMessage = availability.statusMessage
    var selectedMethodName by rememberSaveable { mutableStateOf<String?>(null) }
    val selectedMethod = selectedMethodName?.let { name ->
        runCatching { BiometricMethod.valueOf(name) }.getOrNull()
    }
    val effectiveMethod = if (allowMethodSelection) selectedMethod ?: supportedMethods.firstOrNull() else null
    val unlockTitle = stringResource(R.string.unlock_app_title)
    val unlockSubtitle = stringResource(R.string.unlock_app_subtitle)
    val attendanceTitle = stringResource(R.string.attendance_verify_title)
    val attendanceSubtitle = stringResource(R.string.attendance_verify_subtitle)
    val methodNotAvailableMessage = stringResource(R.string.biometric_method_not_available)

    val unlockMethodHint = when (effectiveMethod) {
        BiometricMethod.FINGERPRINT -> stringResource(R.string.auth_method_fingerprint_hint)
        BiometricMethod.FACE -> stringResource(R.string.auth_method_face_hint)
        BiometricMethod.IRIS -> stringResource(R.string.auth_method_iris_hint)
        null -> stringResource(R.string.auth_method_any_hint)
    }

    fun requestBiometric(title: String, subtitle: String, onSuccess: () -> Unit) {
        if (allowMethodSelection && effectiveMethod == null) {
            onUnlockFailure(methodNotAvailableMessage)
            return
        }

        biometricAuthenticator.authenticate(
            activity = activity,
            title = title,
            subtitle = "$subtitle $unlockMethodHint",
            allowedAuthenticators = availability.allowedAuthenticators,
            onSuccess = onSuccess,
            onError = onUnlockFailure,
        )
    }

    when {
        uiState.requiresAppUnlock -> {
            AppUnlockScreen(
                canAuthenticate = canAuthenticate,
                authMode = authMode,
                supportedMethods = supportedMethods,
                selectedMethod = effectiveMethod,
                onMethodSelected = { method -> selectedMethodName = method.name },
                onUnlockRequest = {
                    requestBiometric(
                        title = unlockTitle,
                        subtitle = unlockSubtitle,
                        onSuccess = onUnlockSuccess,
                    )
                },
                errorMessage = uiState.errorMessage,
                statusMessage = availabilityStatusMessage,
            )
        }

        uiState.session == null -> {
            LoginScreen(
                isLoading = uiState.isLoading,
                onLoginClick = onLogin,
                errorMessage = uiState.errorMessage,
            )
        }

        else -> {
            HomeScreen(
                user = uiState.session.user,
                todayClasses = uiState.todayClasses,
                isLoading = uiState.isLoading,
                authMode = authMode,
                supportedMethods = supportedMethods,
                selectedMethod = effectiveMethod,
                onMethodSelected = { method -> selectedMethodName = method.name },
                onLogout = onLogout,
                onRefresh = { appViewModel.fetchTodayClasses() },
                infoMessage = uiState.infoMessage,
                onMarkAttendance = { classroom, bssid, lat, lon ->
                    requestBiometric(
                        title = attendanceTitle,
                        subtitle = attendanceSubtitle,
                        onSuccess = {
                            appViewModel.markAttendance(classroom, bssid, lat, lon)
                        },
                    )
                },
            )
        }
    }
}
