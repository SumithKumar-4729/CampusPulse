package com.example.campuspulse.util

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.net.wifi.WifiManager
import androidx.core.content.ContextCompat

data class BssidStatus(
    val value: String?,
    val message: String,
)

object WifiInfoProvider {
    fun currentBssid(context: Context): BssidStatus {
        val hasPermission = ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.ACCESS_FINE_LOCATION,
        ) == PackageManager.PERMISSION_GRANTED

        if (!hasPermission) {
            return BssidStatus(
                value = null,
                message = "Location permission is required to read BSSID.",
            )
        }

        val wifiManager = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
            ?: return BssidStatus(value = null, message = "WiFi service unavailable.")

        val bssid = wifiManager.connectionInfo?.bssid
        if (bssid.isNullOrBlank() || bssid == "02:00:00:00:00:00") {
            return BssidStatus(
                value = null,
                message = "BSSID unavailable. Ensure WiFi is connected and location is enabled.",
            )
        }

        return BssidStatus(value = bssid, message = "Connected BSSID detected.")
    }
}

