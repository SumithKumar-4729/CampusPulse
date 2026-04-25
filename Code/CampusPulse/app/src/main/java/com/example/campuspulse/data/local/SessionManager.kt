package com.example.campuspulse.data.local

import android.content.Context
import android.content.SharedPreferences
import com.example.campuspulse.data.model.UserDto
import com.example.campuspulse.ui.UserSession
import com.google.gson.Gson

class SessionManager(context: Context) {
    private val prefs: SharedPreferences = context.getSharedPreferences("campus_pulse_prefs", Context.MODE_PRIVATE)
    private val gson = Gson()

    fun saveSession(session: UserSession) {
        val sessionJson = gson.toJson(session)
        prefs.edit()
            .putString("user_session", sessionJson)
            .putLong("session_timestamp", System.currentTimeMillis())
            .apply()
    }

    fun getSession(): UserSession? {
        val timestamp = prefs.getLong("session_timestamp", 0)
        val oneDayMillis = 24 * 60 * 60 * 1000L
        
        if (System.currentTimeMillis() - timestamp > oneDayMillis) {
            clearSession()
            return null
        }

        val sessionJson = prefs.getString("user_session", null)
        return if (sessionJson != null) {
            gson.fromJson(sessionJson, UserSession::class.java)
        } else {
            null
        }
    }

    fun clearSession() {
        prefs.edit().remove("user_session").remove("session_timestamp").apply()
    }
}
