def test_register_and_login_success(client):
    register_response = client.post(
        "/users",
        json={
            "name": "Alice",
            "email": "alice@example.com",
            "password": "secret123",
            "role": "student",
        },
    )
    assert register_response.status_code == 200
    user = register_response.json()
    assert user["email"] == "alice@example.com"

    login_response = client.post(
        "/users/login",
        json={
            "email": "alice@example.com",
            "password": "secret123",
        },
    )
    assert login_response.status_code == 200
    payload = login_response.json()
    assert payload["token_type"] == "bearer"
    assert payload["access_token"]
    assert payload["user_id"] == user["id"]


def test_register_duplicate_email_returns_409(client):
    payload = {
        "name": "Alice",
        "email": "alice@example.com",
        "password": "secret123",
        "role": "student",
    }
    assert client.post("/users", json=payload).status_code == 200
    duplicate_response = client.post("/users", json=payload)
    assert duplicate_response.status_code == 409


def test_login_invalid_password_returns_401(client):
    client.post(
        "/users",
        json={
            "name": "Alice",
            "email": "alice@example.com",
            "password": "secret123",
            "role": "student",
        },
    )

    login_response = client.post(
        "/users/login",
        json={
            "email": "alice@example.com",
            "password": "wrong-password",
        },
    )
    assert login_response.status_code == 401

