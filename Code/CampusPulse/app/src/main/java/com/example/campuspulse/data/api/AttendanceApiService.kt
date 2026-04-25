package com.example.campuspulse.data.api

import com.example.campuspulse.data.model.AttendanceRequest
import com.example.campuspulse.data.model.AttendanceResponse
import com.example.campuspulse.data.model.ClassroomToday
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.Header
import retrofit2.http.POST

interface AttendanceApiService {
    @GET("classrooms/today")
    suspend fun getTodayClasses(
        @Header("Authorization") token: String
    ): List<ClassroomToday>

    @POST("attendance")
    suspend fun markAttendance(
        @Header("Authorization") token: String,
        @Body request: AttendanceRequest
    ): AttendanceResponse
}
