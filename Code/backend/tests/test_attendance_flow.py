from datetime import datetime
from zoneinfo import ZoneInfo
from uuid import uuid4


def create_user(client, name, email):
    response = client.post(
        "/users",
        json={
            "name": name,
            "email": email,
            "password": "secret123",
            "role": "student",
        },
    )
    assert response.status_code == 200
    return response.json()


def login(client, email):
    response = client.post(
        "/users/login",
        json={
            "email": email,
            "password": "secret123",
        },
    )
    assert response.status_code == 200
    payload = response.json()
    return payload["access_token"]


def create_classroom(client, start_time_str, radius=200.0, attendance_window=30):
    response = client.post(
        "/classrooms",
        json={
            "name": "Room 101",
            "latitude": 22.5726,
            "longitude": 88.3639,
            "radius": radius,
            "class_start_time": start_time_str,
            "attendance_window": attendance_window,
        },
    )
    assert response.status_code == 200
    return response.json()


def add_wifi(client, classroom_id, bssid="AA:BB:CC:DD:EE:FF"):
    response = client.post(
        "/wifi",
        json={
            "classroom_id": classroom_id,
            "bssid": bssid,
        },
    )
    assert response.status_code == 200


def build_attendance_payload(user_id, classroom_id, bssid="AA:BB:CC:DD:EE:FF", request_id=None):
    return {
        "user_id": user_id,
        "classroom_id": classroom_id,
        "bssid": bssid,
        "latitude": 22.5726,
        "longitude": 88.3639,
        "biometric_verified_at": datetime.now(ZoneInfo("Asia/Kolkata")).isoformat(),
        "request_id": request_id or str(uuid4()),
    }


def test_attendance_success_and_duplicate_block(client, now_time_str):
    user = create_user(client, "Alice", "alice@example.com")
    token = login(client, "alice@example.com")
    classroom = create_classroom(client, now_time_str)
    add_wifi(client, classroom["id"])

    headers = {"Authorization": f"Bearer {token}"}
    payload = build_attendance_payload(user["id"], classroom["id"])

    first = client.post("/attendance", json=payload, headers=headers)
    assert first.status_code == 200

    duplicate_payload = build_attendance_payload(user["id"], classroom["id"], request_id=str(uuid4()))
    duplicate = client.post("/attendance", json=duplicate_payload, headers=headers)
    assert duplicate.status_code == 409


def test_attendance_request_id_is_idempotent(client, now_time_str):
    user = create_user(client, "Alice", "alice@example.com")
    token = login(client, "alice@example.com")
    classroom = create_classroom(client, now_time_str)
    add_wifi(client, classroom["id"])

    headers = {"Authorization": f"Bearer {token}"}
    payload = build_attendance_payload(user["id"], classroom["id"], request_id="req-123")

    first = client.post("/attendance", json=payload, headers=headers)
    assert first.status_code == 200

    repeat = client.post("/attendance", json=payload, headers=headers)
    assert repeat.status_code == 200
    assert repeat.json()["id"] == first.json()["id"]


def test_today_classes_requires_auth(client, now_time_str):
    create_classroom(client, now_time_str)

    response = client.get("/classrooms/today")

    assert response.status_code == 401


def test_today_classes_returns_markable_window_metadata(client):
    create_user(client, "Alice", "alice@example.com")
    token = login(client, "alice@example.com")
    now_ist_str = datetime.now(ZoneInfo("Asia/Kolkata")).strftime("%H:%M:%S")
    classroom = create_classroom(client, now_ist_str, attendance_window=45)

    response = client.get(
        "/classrooms/today",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload
    class_item = next(item for item in payload if item["classroom_id"] == classroom["id"])
    assert class_item["name"] == classroom["name"]
    assert class_item["window_start_ist"].endswith("IST")
    assert class_item["window_end_ist"].endswith("IST")
    assert class_item["is_markable_now"] is True


def test_attendance_token_user_mismatch_returns_403(client, now_time_str):
    user_one = create_user(client, "Alice", "alice@example.com")
    create_user(client, "Bob", "bob@example.com")
    bob_token = login(client, "bob@example.com")

    classroom = create_classroom(client, now_time_str)
    add_wifi(client, classroom["id"])

    response = client.post(
        "/attendance",
        json=build_attendance_payload(user_one["id"], classroom["id"]),
        headers={"Authorization": f"Bearer {bob_token}"},
    )
    assert response.status_code == 403


def test_attendance_invalid_bssid_returns_403(client, now_time_str):
    user = create_user(client, "Alice", "alice@example.com")
    token = login(client, "alice@example.com")
    classroom = create_classroom(client, now_time_str)
    add_wifi(client, classroom["id"], bssid="AA:BB:CC:DD:EE:FF")

    response = client.post(
        "/attendance",
        json=build_attendance_payload(user["id"], classroom["id"], bssid="11:22:33:44:55:66"),
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 403

