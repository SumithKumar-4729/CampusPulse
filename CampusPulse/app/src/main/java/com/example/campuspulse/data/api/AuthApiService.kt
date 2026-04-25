package com.example.campuspulse.data.api

import com.example.campuspulse.data.model.LoginRequest
import com.example.campuspulse.data.model.LoginResponse
import retrofit2.http.Body
import retrofit2.http.POST

interface AuthApiService {
    @POST("users/login")
    suspend fun login(@Body request: LoginRequest): LoginResponse
}

