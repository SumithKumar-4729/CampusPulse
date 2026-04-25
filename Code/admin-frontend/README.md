# CampusPulse Frontend (Dark Mode)

A complete role-based college attendance frontend with production-style UX.

## Product Model

- Attendance marking is handled by Android app (in-class flow).
- Web portal is the system of visibility and governance:
	- Students see history, trends, and attendance health.
	- Admins can inspect all students, review classroom feeds, and apply controlled attendance overrides.

## Files

- `index.html` - app shell, auth screen, role dashboard, live sync pill, toast area
- `styles.css` - dark theme, responsive layout, animations, admin tools styling
- `app.js` - complete app logic, API sync layer, analytics, override engine, CSV export

## Run Locally

Use any static server from this folder:

```bash
cd /mnt/data/WifiBSSID/Codes/admin-frontend
python3 -m http.server 5173
```

Then open:

- http://127.0.0.1:5173

## Implemented Feature Set

### Admin

- Overview dashboard with governance alerts and classroom window status
- Class appointment planner (persistent in browser local storage)
- Student Explorer:
	- inspect any student
	- review full attendance history
	- edit status via admin override with mandatory reason
	- export student attendance CSV
- Attendance Control:
	- classroom attendance feed viewer
	- policy preview for radius/window/BSSID
	- refresh classroom records

### Student

- My Dashboard with attendance KPIs
- Attendance Analytics with:
	- monthly trend graph
	- course-wise attendance graph
- Attendance History table with source tags

### Cross-cutting

- Role switch support (Admin <-> Student)
- Session persistence in local storage
- Sync mode indicator:
	- Live API Sync
	- Demo Dataset
	- Offline Fallback
- Toast notifications for user feedback

## Backend Connectivity

Configured API base in `app.js`:

```js
const API_BASE = "http://127.0.0.1:8000";
```

Integrated endpoints:

- `POST /users/login`
- `GET /classrooms/today`
- `GET /attendance/user/{user_id}`
- `GET /attendance/classroom/{classroom_id}`

If backend is not reachable, app auto-falls back to demo data so UI remains usable.

## Important Limitation

- Current backend reference does not expose an admin attendance update endpoint.
- Admin edits in this frontend are implemented as controlled local overrides (with reason and timestamp).
- To make overrides permanent server-side, add an endpoint such as:
	- `PATCH /attendance/{attendance_id}` or
	- `POST /attendance/override`

## Design Direction

- Always dark mode
- Academic dashboard style with high contrast and clear information density
- Mobile-responsive for quick in-campus usage
