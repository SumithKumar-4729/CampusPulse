package com.example.campuspulse.ui.screens

import android.Manifest
import android.content.pm.PackageManager
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import com.example.campuspulse.data.model.ClassroomToday
import com.example.campuspulse.data.model.UserDto
import com.example.campuspulse.security.AuthMode
import com.example.campuspulse.security.BiometricMethod
import com.example.campuspulse.util.BssidStatus
import com.example.campuspulse.util.WifiInfoProvider

import com.example.campuspulse.util.LocationProvider
import kotlinx.coroutines.launch

private const val LOCATION_PERMISSION_REQUEST_CODE = 1001

@Composable
fun AppUnlockScreen(
    canAuthenticate: Boolean,
    authMode: AuthMode,
    supportedMethods: List<BiometricMethod>,
    selectedMethod: BiometricMethod?,
    onMethodSelected: (BiometricMethod) -> Unit,
    onUnlockRequest: () -> Unit,
    statusMessage: String,
    errorMessage: String?,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Icon(
            Icons.Default.Lock,
            contentDescription = null,
            modifier = Modifier.size(64.dp),
            tint = MaterialTheme.colorScheme.primary
        )
        Spacer(modifier = Modifier.height(24.dp))
        Text("Campus Pulse", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
        Spacer(modifier = Modifier.height(8.dp))
        
        val modeLabel = when (authMode) {
            AuthMode.BIOMETRIC_STRICT -> "App Locked. Use Biometrics to open."
            AuthMode.DEVICE_CREDENTIAL_FALLBACK -> "App Locked. Use Screen Lock to open."
            AuthMode.UNAVAILABLE -> "Security verification is unavailable."
        }
        Text(modeLabel, style = MaterialTheme.typography.bodyMedium)

        Spacer(modifier = Modifier.height(32.dp))

        if (authMode == AuthMode.BIOMETRIC_STRICT && supportedMethods.size > 1) {
            Text("Preferred Biometric:", style = MaterialTheme.typography.labelLarge)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                supportedMethods.forEach { method ->
                    FilterChip(
                        selected = selectedMethod == method,
                        onClick = { onMethodSelected(method) },
                        label = { Text(if (method == BiometricMethod.FACE) "Face" else "Fingerprint") }
                    )
                }
            }
            Spacer(modifier = Modifier.height(16.dp))
        }

        Button(
            onClick = onUnlockRequest,
            enabled = canAuthenticate,
            modifier = Modifier.fillMaxWidth().height(56.dp),
            shape = MaterialTheme.shapes.medium
        ) {
            Text("Unlock App")
        }

        if (!canAuthenticate) {
            Text(
                text = statusMessage,
                color = MaterialTheme.colorScheme.error,
                modifier = Modifier.padding(top = 16.dp)
            )
        }

        errorMessage?.let {
            Text(text = it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 16.dp))
        }
    }
}

@Composable
fun HomeScreen(
    user: UserDto,
    todayClasses: List<ClassroomToday>,
    isLoading: Boolean,
    authMode: AuthMode,
    supportedMethods: List<BiometricMethod>,
    selectedMethod: BiometricMethod?,
    onMethodSelected: (BiometricMethod) -> Unit,
    onMarkAttendance: (ClassroomToday, String, Double, Double) -> Unit,
    onRefresh: () -> Unit,
    onLogout: () -> Unit,
    infoMessage: String?,
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    var bssidStatus by remember {
        mutableStateOf(BssidStatus(null, "Checking WiFi..."))
    }
    val locationPermissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission(),
    ) { granted ->
        if (granted) {
            bssidStatus = WifiInfoProvider.currentBssid(context)
            onRefresh()
        }
    }

    DisposableEffect(lifecycleOwner, context) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) {
                bssidStatus = WifiInfoProvider.currentBssid(context)
                onRefresh()
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    val hasLocationPermission = ContextCompat.checkSelfPermission(
        context,
        Manifest.permission.ACCESS_FINE_LOCATION,
    ) == PackageManager.PERMISSION_GRANTED

    LazyColumn(
        modifier = Modifier.fillMaxSize().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        item {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(
                    text = "Campus Pulse",
                    style = MaterialTheme.typography.headlineMedium,
                    color = MaterialTheme.colorScheme.primary,
                    fontWeight = FontWeight.Bold
                )
                Text(text = "Student Portal", style = MaterialTheme.typography.bodySmall)
            }
        }

        item {
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Text(text = user.name, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                    Text(text = "Student ID: ${user.id}", style = MaterialTheme.typography.bodyMedium)
                    Text(text = user.email, style = MaterialTheme.typography.bodySmall)
                }
            }
        }

        item {
            BssidPanel(
                bssidStatus = bssidStatus,
                onRefresh = { 
                    bssidStatus = WifiInfoProvider.currentBssid(context)
                    onRefresh()
                },
                hasLocationPermission = hasLocationPermission,
                onRequestPermission = {
                    locationPermissionLauncher.launch(Manifest.permission.ACCESS_FINE_LOCATION)
                }
            )
        }

        item {
            Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text("Today's Timetable", style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                if (isLoading) {
                    CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp)
                } else {
                    IconButton(onClick = { 
                        bssidStatus = WifiInfoProvider.currentBssid(context)
                        onRefresh()
                    }) {
                        Icon(Icons.Default.Refresh, contentDescription = "Refresh Timetable")
                    }
                }
            }
            HorizontalDivider()
        }

        if (todayClasses.isEmpty() && !isLoading) {
            item {
                Text("No classes scheduled for today.", style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(16.dp))
            }
        }

        items(todayClasses) { classroom ->
            ClassroomCard(
                classroom = classroom,
                currentBssid = bssidStatus.value,
                hasLocationPermission = hasLocationPermission,
                onMarkAttendance = { bssid, lat, lon ->
                    onMarkAttendance(classroom, bssid, lat, lon)
                }
            )
        }

        item {
            Spacer(modifier = Modifier.height(16.dp))
            Button(
                onClick = onLogout,
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error)
            ) {
                Text("Log Out")
            }
            infoMessage?.let {
                Text(text = it, color = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(top = 8.dp))
            }
            Spacer(modifier = Modifier.height(32.dp))
        }
    }
}

@Composable
private fun ClassroomCard(
    classroom: ClassroomToday,
    currentBssid: String?,
    hasLocationPermission: Boolean,
    onMarkAttendance: (String, Double, Double) -> Unit
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    Card(
        modifier = Modifier.fillMaxWidth(),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(text = classroom.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                    Text(text = "${classroom.window_start_ist} - ${classroom.window_end_ist}", style = MaterialTheme.typography.bodySmall)
                }
                if (classroom.is_markable_now) {
                    Icon(Icons.Default.CheckCircle, contentDescription = "Active", tint = Color(0xFF4CAF50))
                }
            }

            if (classroom.status_note != null) {
                Text(text = classroom.status_note, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
            }

            Spacer(modifier = Modifier.height(12.dp))

            Button(
                onClick = {
                    if (!hasLocationPermission) return@Button
                    scope.launch {
                        val location = LocationProvider.getCurrentLocation(context)
                        if (location != null) {
                            onMarkAttendance(
                                currentBssid ?: "",
                                location.latitude,
                                location.longitude,
                            )
                        }
                    }
                },
                enabled = classroom.is_markable_now && !currentBssid.isNullOrBlank() && hasLocationPermission,
                modifier = Modifier.fillMaxWidth()
            ) {
                Icon(Icons.Default.Fingerprint, contentDescription = null)
                Spacer(modifier = Modifier.width(8.dp))
                Text("Mark Attendance")
            }

            if (!hasLocationPermission) {
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = "Grant location permission while using the app to read BSSID and mark attendance.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                )
            }
        }
    }
}

@Composable
private fun BssidPanel(
    bssidStatus: BssidStatus,
    onRefresh: () -> Unit,
    hasLocationPermission: Boolean,
    onRequestPermission: () -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = if (bssidStatus.value != null) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.errorContainer
        )
    ) {
        Row(modifier = Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(if (hasLocationPermission) Icons.Default.Wifi else Icons.Default.LocationOn, contentDescription = null)
            Spacer(modifier = Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(text = if (bssidStatus.value != null) "WiFi: ${bssidStatus.value}" else "WiFi Not Connected", style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Bold)
                Text(text = bssidStatus.message, style = MaterialTheme.typography.labelSmall)
            }
            IconButton(onClick = if (hasLocationPermission) onRefresh else onRequestPermission) {
                Icon(if (hasLocationPermission) Icons.Default.Refresh else Icons.Default.Info, contentDescription = "Refresh")
            }
        }
    }
}
