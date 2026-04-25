package com.example.campuspulse.data.repository

import com.example.campuspulse.data.api.AttendanceApiService
import com.example.campuspulse.data.model.AttendanceRequest
import com.example.campuspulse.data.model.AttendanceResponse
import com.example.campuspulse.data.model.ClassroomToday
import org.json.JSONObject
import retrofit2.HttpException

class AttendanceRepository(
    private val attendanceApiService: AttendanceApiService
) {
    suspend fun getTodayClasses(token: String): Result<List<ClassroomToday>> {
        return try {
            val response = attendanceApiService.getTodayClasses("Bearer $token")
            Result.success(response)
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun markAttendance(token: String, request: AttendanceRequest): Result<AttendanceResponse> {
        return try {
            val response = attendanceApiService.markAttendance("Bearer $token", request)
            Result.success(response)
        } catch (httpException: HttpException) {
            val detail = httpException.response()?.errorBody()?.string()?.let { raw ->
                try {
                    JSONObject(raw).optString("detail").takeIf { it.isNotBlank() }
                } catch (_: Exception) {
                    null
                }
            }
            Result.failure(Exception(detail ?: httpException.message ?: "Failed to mark attendance"))
        } catch (e: Exception) {
            Result.failure(Exception(e.message ?: "Network error"))
        }
    }
}
