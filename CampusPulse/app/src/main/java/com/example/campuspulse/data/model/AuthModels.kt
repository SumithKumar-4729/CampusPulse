package com.example.campuspulse.data.model

data class LoginRequest(
    val email: String,
    val password: String,
)

data class UserDto(
    val id: Int,
    val name: String,
    val email: String,
    val role: String,
)

data class LoginResponse(
    val access_token: String,
    val token_type: String,
    val user_id: Int,
    val user: UserDto,
)

