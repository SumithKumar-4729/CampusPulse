package com.example.campuspulse.data.repository

import com.example.campuspulse.data.api.AuthApiService
import com.example.campuspulse.data.model.LoginRequest
import com.example.campuspulse.data.model.LoginResponse
import org.json.JSONObject
import retrofit2.HttpException

class AuthRepository(
    private val authApiService: AuthApiService,
) {
    suspend fun login(email: String, password: String): Result<LoginResponse> {
        return try {
            val response = authApiService.login(LoginRequest(email = email, password = password))
            Result.success(response)
        } catch (httpException: HttpException) {
            val detail = httpException.response()?.errorBody()?.string()?.let { raw ->
                try {
                    JSONObject(raw).optString("detail").takeIf { it.isNotBlank() }
                } catch (_: Exception) {
                    null
                }
            }
            Result.failure(Exception(detail ?: httpException.message ?: "Login failed"))
        } catch (exception: Exception) {
            Result.failure(Exception(exception.message ?: "Network error"))
        }
    }
}

