package com.example.campuspulse.data.model

data class ClassroomToday(
    val classroom_id: Int,
    val name: String,
    val class_start_time: String?,
    val attendance_window: Int?,
    val window_start_ist: String?,
    val window_end_ist: String?,
    val is_markable_now: Boolean,
    val status_note: String?
)

data class AttendanceRequest(
    val user_id: Int,
    val classroom_id: Int,
    val bssid: String,
    val latitude: Double,
    val longitude: Double,
    val biometric_verified_at: String?,
    val request_id: String
)

data class AttendanceResponse(
    val id: Int,
    val user_id: Int,
    val classroom_id: Int,
    val timestamp: String,
    val status: String?
)
