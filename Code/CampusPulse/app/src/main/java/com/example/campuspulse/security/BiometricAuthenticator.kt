package com.example.campuspulse.security

import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity

enum class BiometricMethod {
    FINGERPRINT,
    FACE,
    IRIS,
}

enum class AuthMode {
    BIOMETRIC_STRICT,
    DEVICE_CREDENTIAL_FALLBACK,
    UNAVAILABLE,
}

data class BiometricAvailability(
    val canAuthenticate: Boolean,
    val authMode: AuthMode,
    val allowedAuthenticators: Int,
    val supportedMethods: List<BiometricMethod>,
    val statusMessage: String,
)

class BiometricAuthenticator {
    fun availability(activity: FragmentActivity): BiometricAvailability {
        val manager = BiometricManager.from(activity)
        val packageManager = activity.packageManager

        // Standard and vendor-specific biometric features
        val hasFace = packageManager.hasSystemFeature("android.hardware.biometrics.face") || 
                     packageManager.hasSystemFeature("com.samsung.android.bio.face") ||
                     packageManager.hasSystemFeature("android.hardware.camera.front") // Generic fallback for UI hint
        val hasFingerprint = packageManager.hasSystemFeature("android.hardware.fingerprint") || 
                           packageManager.hasSystemFeature("android.hardware.biometrics.fingerprint") ||
                           packageManager.hasSystemFeature("com.samsung.android.bio.fingerprint")
        val hasIris = packageManager.hasSystemFeature("android.hardware.biometrics.iris") ||
                     packageManager.hasSystemFeature("com.samsung.android.bio.iris")

        // We check for both WEAK and STRONG. 
        // BIOMETRIC_WEAK (Class 2) generally includes BIOMETRIC_STRONG (Class 3).
        val biometricResult = manager.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_WEAK)
        val credentialResult = manager.canAuthenticate(BiometricManager.Authenticators.DEVICE_CREDENTIAL)

        val authMode = when {
            biometricResult == BiometricManager.BIOMETRIC_SUCCESS -> AuthMode.BIOMETRIC_STRICT
            credentialResult == BiometricManager.BIOMETRIC_SUCCESS -> AuthMode.DEVICE_CREDENTIAL_FALLBACK
            else -> AuthMode.UNAVAILABLE
        }

        val canAuthenticate = authMode != AuthMode.UNAVAILABLE
        val allowedAuthenticators = when (authMode) {
            AuthMode.BIOMETRIC_STRICT -> BiometricManager.Authenticators.BIOMETRIC_WEAK or BiometricManager.Authenticators.BIOMETRIC_STRONG
            AuthMode.DEVICE_CREDENTIAL_FALLBACK -> BiometricManager.Authenticators.DEVICE_CREDENTIAL
            AuthMode.UNAVAILABLE -> 0
        }

        val supportedMethods = buildList {
            if (hasFingerprint) add(BiometricMethod.FINGERPRINT)
            if (hasFace) add(BiometricMethod.FACE)
            if (hasIris) add(BiometricMethod.IRIS)
        }

        return BiometricAvailability(
            canAuthenticate = canAuthenticate,
            authMode = authMode,
            allowedAuthenticators = allowedAuthenticators,
            supportedMethods = supportedMethods,
            statusMessage = mapStatusMessage(authMode, biometricResult, credentialResult, supportedMethods),
        )
    }

    private fun mapStatusMessage(
        mode: AuthMode, 
        biometricCode: Int, 
        credentialCode: Int,
        methods: List<BiometricMethod>,
    ): String {
        val hasHardware = methods.isNotEmpty()
        val hasFace = methods.contains(BiometricMethod.FACE)
        val hasFingerprint = methods.contains(BiometricMethod.FINGERPRINT)
        val hasIris = methods.contains(BiometricMethod.IRIS)

        return when (mode) {
            AuthMode.BIOMETRIC_STRICT -> {
                val methodNames = buildList {
                    if (hasFace) add("face")
                    if (hasFingerprint) add("fingerprint")
                    if (hasIris) add("iris")
                }
                if (methodNames.isEmpty()) "Biometric authentication is available."
                else "Biometric authentication is available (${methodNames.joinToString(" or ")})."
            }
            AuthMode.DEVICE_CREDENTIAL_FALLBACK -> {
                if (biometricCode == BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED && hasHardware) {
                    val target = if (hasFace && !hasFingerprint) "Face ID" else if (hasFingerprint && !hasFace) "Fingerprint" else "biometrics"
                    "Enroll your $target in phone settings for a faster experience. Using screen lock for now."
                } else if (!hasHardware) {
                    "No biometric hardware detected. Using device screen lock for security."
                } else {
                    "Using device screen lock for security."
                }
            }
            AuthMode.UNAVAILABLE -> {
                if (hasHardware) {
                    when (biometricCode) {
                        BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED -> "Please enroll biometrics (Face/Fingerprint) in phone settings."
                        BiometricManager.BIOMETRIC_ERROR_HW_UNAVAILABLE -> "Biometric hardware is busy or unavailable."
                        BiometricManager.BIOMETRIC_ERROR_SECURITY_UPDATE_REQUIRED -> "A security update is required for biometric authentication."
                        else -> "Biometric security is required but currently unavailable."
                    }
                } else {
                    when (credentialCode) {
                        BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED -> "Please configure a screen lock (PIN/Pattern/Password) on this device."
                        else -> "No biometric hardware or screen lock configured on this device."
                    }
                }
            }
        }
    }

    fun authenticate(
        activity: FragmentActivity,
        title: String,
        subtitle: String,
        allowedAuthenticators: Int,
        onSuccess: () -> Unit,
        onError: (String) -> Unit,
    ) {
        if (allowedAuthenticators == 0) {
            onError("Authentication is unavailable on this device.")
            return
        }

        val executor = ContextCompat.getMainExecutor(activity)
        val biometricPrompt = BiometricPrompt(
            activity,
            executor,
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                    onSuccess()
                }

                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                    onError(errString.toString())
                }

                override fun onAuthenticationFailed() {
                    onError("Authentication failed. Try again.")
                }
            },
        )

        val builder = BiometricPrompt.PromptInfo.Builder()
            .setTitle(title)
            .setSubtitle(subtitle)
            .setAllowedAuthenticators(allowedAuthenticators)
            .setConfirmationRequired(false)

        // If DEVICE_CREDENTIAL is NOT allowed, a negative button text MUST be provided.
        if ((allowedAuthenticators and BiometricManager.Authenticators.DEVICE_CREDENTIAL) == 0) {
            builder.setNegativeButtonText("Cancel")
        }

        val promptInfo = builder.build()

        biometricPrompt.authenticate(promptInfo)
    }
}

