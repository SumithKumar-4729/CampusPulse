const API_BASE = resolveApiBase();
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const STORAGE_KEYS = {
  token: "campuspulse_token",
  session: "campuspulse_session",
  overrides: "campuspulse_attendance_overrides",
  appointments: "campuspulse_admin_appointments",
  attendanceRange: "campuspulse_attendance_range"
};

const state = {
  currentRole: "admin",
  page: "overview",
  user: null,
  syncMode: "offline",
  loading: false,
  messageTimer: null,
  sessionTimer: null,
  sessionExpiresAt: null,
  selectedStudentId: 1,
  selectedClassroomId: null,
  editingClassroomId: null,
  editingSessionId: null,
  classroomsCatalog: [],
  classroomsToday: [],
  classSessions: [],
  recentWifiRegistrations: [],
  attendanceByUser: {},
  attendanceByClassroom: {},
  enrollmentsByUser: {},
  attendanceRange: loadAttendanceRange(),
  data: {
    students: [],
    schedule: loadSchedule()
  }
};

const pagesByRole = {
  admin: [
    { key: "overview", label: "Overview" },
    { key: "schedule", label: "Class Schedule" },
    { key: "students", label: "Student Explorer" },
    { key: "classrooms", label: "Classroom Master" },
    { key: "attendance", label: "Attendance Control" }
  ],
  student: [
    { key: "overview", label: "Dashboard / Overview" },
    { key: "courses", label: "My Courses" },
    { key: "timetable", label: "Timetable" },
    { key: "analytics", label: "Analytics" },
    { key: "history", label: "History" },
    { key: "daily", label: "Daily Attendance" }
  ]
};

const el = {
  authCard: document.getElementById("authCard"),
  dashboard: document.getElementById("dashboard"),
  loginForm: document.getElementById("loginForm"),
  roleHeading: document.getElementById("roleHeading"),
  userIdentity: document.getElementById("userIdentity"),
  roleNav: document.getElementById("roleNav"),
  pageTitle: document.getElementById("pageTitle"),
  pageMount: document.getElementById("pageMount"),
  logoutBtn: document.getElementById("logoutBtn"),
  kpiCardTpl: document.getElementById("kpiCardTpl"),
  syncPill: document.getElementById("syncPill"),
  toast: document.getElementById("toast")
};

el.loginForm.addEventListener("submit", onLogin);
el.logoutBtn.addEventListener("click", logout);

// Allow Enter key to submit login form
const passwordField = document.getElementById("password");
if (passwordField) {
  passwordField.addEventListener("keypress", (event) => {
    if (event.key === "Enter") {
      el.loginForm.requestSubmit();
    }
  });
}

bootstrap();

async function bootstrap() {
  const session = loadSession();
  if (session) {
    state.currentRole = session.currentRole;
    state.user = session.user;
    state.page = session.page || "overview";
    state.selectedStudentId = session.selectedStudentId || 1;
    state.sessionExpiresAt = session.expiresAt || null;
    el.authCard.classList.add("hidden");
    el.dashboard.classList.remove("hidden");
    scheduleSessionExpiry(state.sessionExpiresAt);
  }

  await refreshCoreData();
  renderApp();
}

async function onLogin(event) {
  event.preventDefault();
  const fd = new FormData(el.loginForm);
  const selectedRole = String(fd.get("role") || "student").toLowerCase();
  const email = String(fd.get("email") || "").trim();
  const password = String(fd.get("password") || "");
  let auth = null;

  if (!email || !password) {
    showToast("Email and password are required.", true);
    return;
  }

  state.loading = true;
  updateSyncPill();

  try {
    auth = await apiLogin(email, password);
    localStorage.setItem(STORAGE_KEYS.token, auth.access_token);
    state.syncMode = "live";
  } catch (err) {
    state.loading = false;
    updateSyncPill();
    showToast(`Login failed: ${err.message}`, true);
    return;
  }

  // Validate selected role matches backend role
  const backendUser = auth && auth.user ? auth.user : null;
  const backendRole = backendUser && backendUser.role ? String(backendUser.role).toLowerCase() : null;

  if (!backendRole || backendRole !== selectedRole) {
    localStorage.removeItem(STORAGE_KEYS.token);
    state.loading = false;
    updateSyncPill();
    const correctRole = backendRole || "unknown";
    showToast(`Role mismatch. Your account is a ${correctRole}, not ${selectedRole}.`, true);
    return;
  }

  const mappedStudent = state.data.students.find((s) => s.email.toLowerCase() === email.toLowerCase());

  state.currentRole = backendRole;
  state.user = {
    email: backendUser.email,
    id: Number(backendUser.id),
    name: backendUser.name || email.split("@")[0]
  };

  if (state.currentRole === "admin") {
    state.selectedStudentId = state.data.students[0] ? state.data.students[0].id : state.user.id;
  } else {
    state.selectedStudentId = state.user.id;
  }
  state.page = "overview";
  state.loading = false;
  updateSyncPill();
  state.sessionExpiresAt = Date.now() + SESSION_TTL_MS;
  persistSession();
  scheduleSessionExpiry(state.sessionExpiresAt);

  el.authCard.classList.add("hidden");
  el.dashboard.classList.remove("hidden");

  await refreshCoreData();
  renderApp();
  showToast(`${state.currentRole === "admin" ? "Admin" : "Student"} workspace ready.`);
}

function logout() {
  clearSessionTimer();
  state.user = null;
  state.page = "overview";
  state.sessionExpiresAt = null;
  localStorage.removeItem(STORAGE_KEYS.token);
  localStorage.removeItem(STORAGE_KEYS.session);
  el.dashboard.classList.add("hidden");
  el.authCard.classList.remove("hidden");
  el.loginForm.reset();
  showToast("Logged out successfully.");
}

async function refreshCoreData() {
  await loadStudentsLive();
  await refreshClassroomsData();
  await loadClassSessionsLive();

  await ensureAttendanceLoadedFor(state.selectedStudentId);
  if (state.currentRole === "student" && state.user && state.user.id) {
    await ensureEnrollmentsLoadedFor(state.user.id, true);
  }
  if (state.selectedClassroomId) {
    await ensureClassroomAttendanceLoaded(state.selectedClassroomId);
  }
}

async function refreshClassroomsData() {
  const token = localStorage.getItem(STORAGE_KEYS.token);
  if (!token) {
    state.classroomsCatalog = [];
    state.classroomsToday = [];
    state.selectedClassroomId = null;
    return;
  }

  let liveAvailable = false;

  try {
    const catalogRows = await request("/classrooms");
    state.classroomsCatalog = normalizeClassrooms(catalogRows);
    liveAvailable = true;
  } catch {
    state.classroomsCatalog = [];
  }

  try {
    const todayRows = await request("/classrooms/today");
    state.classroomsToday = normalizeClassrooms(todayRows);
    liveAvailable = true;
  } catch {
    state.classroomsToday = [];
  }

  if (!state.classroomsCatalog.length && state.classroomsToday.length) {
    state.classroomsCatalog = [...state.classroomsToday];
  }

  const options = getClassroomOptions();
  if (options.length) {
    const hasSelected = options.some((row) => Number(row.id) === Number(state.selectedClassroomId));
    if (!hasSelected) {
      state.selectedClassroomId = options[0].id;
    }
  } else {
    state.selectedClassroomId = null;
  }

  state.syncMode = liveAvailable ? "live" : "offline";
}

async function loadStudentsLive() {
  if (!localStorage.getItem(STORAGE_KEYS.token)) {
    return;
  }

  try {
    const users = await request("/users?role=student");
    if (Array.isArray(users) && users.length) {
      state.data.students = users.map((u) => ({
        id: Number(u.id),
        email: u.email,
        name: u.name || u.email,
        department: "N/A",
        semester: "-"
      }));
    }
    state.syncMode = "live";
  } catch {
    state.syncMode = "offline";
  }
}

async function loadClassSessionsLive() {
  if (!localStorage.getItem(STORAGE_KEYS.token)) {
    return;
  }

  try {
    const rows = await request("/class-sessions");
    state.classSessions = Array.isArray(rows) ? rows.map((row) => ({
      id: Number(row.id),
      classroom_id: Number(row.classroom_id),
      title: row.title || "Class Session",
      faculty: row.faculty || "-",
      session_date: row.session_date || null,
      class_start_time: row.class_start_time || null,
      class_end_time: row.class_end_time || null,
      attendance_window: row.attendance_window || null,
      markable_now: false
    })) : [];
  } catch {
    state.classSessions = [];
  }
}

function renderApp() {
  updateSyncPill();
  const roleTitle = state.currentRole === "admin" ? "Admin Console" : "Student Portal";
  el.roleHeading.textContent = roleTitle;
  el.userIdentity.textContent = state.user ? `${state.user.name} • ${state.user.email}` : "Guest";
  renderNav();
  renderPage();
}

function renderNav() {
  el.roleNav.innerHTML = "";
  const pages = pagesByRole[state.currentRole];
  pages.forEach((page) => {
    const btn = document.createElement("button");
    btn.className = `nav-item${state.page === page.key ? " active" : ""}`;
    btn.textContent = page.label;
    btn.addEventListener("click", async () => {
      state.page = page.key;
      persistSession();
      if (page.key === "students" || page.key === "history" || page.key === "analytics" || page.key === "daily") {
        await ensureAttendanceLoadedFor(state.currentRole === "student" ? state.user.id : state.selectedStudentId);
      }
      if (state.currentRole === "student" && (page.key === "courses" || page.key === "timetable" || page.key === "overview")) {
        await ensureEnrollmentsLoadedFor(state.user.id, true);
      }
      if (page.key === "students" && state.currentRole === "admin") {
        await ensureEnrollmentsLoadedFor(state.selectedStudentId, true);
      }
      renderNav();
      renderPage();
    });
    el.roleNav.appendChild(btn);
  });
}

function renderPage() {
  const role = state.currentRole;
  const page = state.page;

  if (role === "admin" && page === "overview") {
    el.pageTitle.textContent = "Admin Overview";
    renderAdminOverview();
    return;
  }
  if (role === "admin" && page === "schedule") {
    el.pageTitle.textContent = "Class Schedule";
    renderAdminSchedule();
    return;
  }
  if (role === "admin" && page === "students") {
    el.pageTitle.textContent = "Student Explorer";
    renderAdminStudents();
    return;
  }
  if (role === "admin" && page === "classrooms") {
    el.pageTitle.textContent = "Classroom Master";
    renderAdminClassrooms();
    return;
  }
  if (role === "admin" && page === "attendance") {
    el.pageTitle.textContent = "Attendance Control";
    renderAdminAttendanceControl();
    return;
  }

  if (role === "student" && page === "overview") {
    el.pageTitle.textContent = "Dashboard / Overview";
    renderStudentOverview();
    return;
  }
  if (role === "student" && page === "courses") {
    el.pageTitle.textContent = "My Courses";
    renderStudentCourses();
    return;
  }
  if (role === "student" && page === "timetable") {
    el.pageTitle.textContent = "Timetable";
    renderStudentTimetable();
    return;
  }
  if (role === "student" && page === "analytics") {
    el.pageTitle.textContent = "Analytics";
    renderStudentAnalytics();
    return;
  }
  if (role === "student" && page === "history") {
    el.pageTitle.textContent = "History";
    renderStudentHistory();
    return;
  }

  el.pageTitle.textContent = "Daily Attendance";
  renderStudentDailyAttendance();
}

function renderAdminOverview() {
  const records = getRecordsForUser(state.selectedStudentId);
  const totalStudents = state.data.students.length;
  const totalMarkedToday = state.classroomsToday.reduce((acc, c) => acc + (c.markable_now ? 1 : 0), 0);
  const overrides = getAllOverrides().length;
  const kpis = [
    { label: "Registered Students", value: String(totalStudents), foot: "Portal-visible student profiles" },
    { label: "Today Active Classrooms", value: String(totalMarkedToday), foot: "Attendance window currently open" },
    { label: "Selected Student Records", value: String(records.length), foot: "Combined live + override entries" },
    { label: "Manual Overrides", value: String(overrides), foot: "Audit-sensitive corrections" }
  ];

  el.pageMount.innerHTML = "";
  el.pageMount.appendChild(renderKPIs(kpis));

  const layout = document.createElement("section");
  layout.className = "layout-2";

  const panel = document.createElement("article");
  panel.className = "panel";
  panel.innerHTML = "<h4>Today Classrooms</h4>";
  panel.appendChild(makeClassroomWindowTable(state.classroomsToday));

  layout.appendChild(panel);
  el.pageMount.appendChild(layout);
}

function renderAdminSchedule() {
  el.pageMount.innerHTML = "";
  const editingSession = state.classSessions.find((row) => Number(row.id) === Number(state.editingSessionId)) || null;

  const formPanel = document.createElement("article");
  formPanel.className = "panel";
  formPanel.innerHTML = `
    <h4>Plan Class Session</h4>
    <form id="appointmentForm" class="quick-form">
      <div class="split-2">
        <input name="title" placeholder="Course Name" required />
        <input name="faculty" placeholder="Faculty" required />
      </div>
      <div class="split-2">
        <select name="classroom_id" required>
          <option value="">Select Classroom</option>
          ${getClassroomOptions().map((row) => `<option value="${row.id}">${row.name} (#${row.id})</option>`).join("")}
        </select>
        <input name="session_date" type="date" required />
      </div>
      <div class="split-2">
        <input name="class_start_time" type="time" required />
        <input name="class_end_time" type="time" required />
      </div>
      <div class="split-2">
        <input name="attendance_window" type="number" min="1" step="1" placeholder="Attendance Window (minutes)" required />
        <input value="Attendance starts at class start" disabled />
      </div>
      <button type="submit" class="btn-primary">Schedule Class</button>
      <p class="micro-note">Assign session to classroom with faculty, class time range, and attendance window.</p>
    </form>
  `;

  const listPanel = document.createElement("article");
  listPanel.className = "panel";
  listPanel.innerHTML = "<h4>Class Schedule</h4>";
  const listWrap = document.createElement("div");
  listWrap.className = "student-list";
  state.classSessions.forEach((appt) => {
    const card = renderScheduleItem(appt);
    const actions = document.createElement("div");
    actions.className = "toolbar";
    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "btn-inline";
    editBtn.textContent = "Edit Session";
    editBtn.addEventListener("click", () => {
      state.editingSessionId = Number(appt.id);
      renderAdminSchedule();
    });
    actions.appendChild(editBtn);
    card.appendChild(actions);
    listWrap.appendChild(card);
  });
  listPanel.appendChild(listWrap);

  const editPanel = document.createElement("article");
  editPanel.className = "panel";
  if (editingSession) {
    editPanel.innerHTML = `
      <h4>Edit Scheduled Class</h4>
      <form id="editSessionForm" class="quick-form">
        <div class="split-2">
          <input name="title" placeholder="Course Name" required value="${escapeAttr(editingSession.title || "")}" />
          <input name="faculty" placeholder="Faculty" required value="${escapeAttr(editingSession.faculty || "")}" />
        </div>
        <div class="split-2">
          <select name="classroom_id" required>
            <option value="">Select Classroom</option>
            ${getClassroomOptions().map((row) => `<option value="${row.id}" ${Number(row.id) === Number(editingSession.classroom_id) ? "selected" : ""}>${row.name} (#${row.id})</option>`).join("")}
          </select>
          <input name="session_date" type="date" required value="${escapeAttr(editingSession.session_date || "")}" />
        </div>
        <div class="split-2">
          <input name="class_start_time" type="time" required value="${escapeAttr(toInputTimeValue(editingSession.class_start_time))}" />
          <input name="class_end_time" type="time" required value="${escapeAttr(toInputTimeValue(editingSession.class_end_time))}" />
        </div>
        <div class="split-2">
          <input name="attendance_window" type="number" min="1" step="1" placeholder="Attendance Window (minutes)" required value="${Number(editingSession.attendance_window) || ""}" />
          <input value="Editing session #${editingSession.id}" disabled />
        </div>
        <div class="toolbar">
          <button type="submit" class="btn-primary">Save Changes</button>
          <button type="button" class="btn-inline" id="cancelSessionEdit">Cancel</button>
        </div>
      </form>
    `;

    const editForm = editPanel.querySelector("#editSessionForm");
    editForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const fd = new FormData(editForm);
      const payload = {
        title: String(fd.get("title") || "").trim(),
        faculty: String(fd.get("faculty") || "").trim(),
        classroom_id: Number(fd.get("classroom_id")),
        session_date: String(fd.get("session_date") || ""),
        class_start_time: String(fd.get("class_start_time") || ""),
        class_end_time: String(fd.get("class_end_time") || ""),
        attendance_window: Number(fd.get("attendance_window"))
      };

      if (!payload.title || !payload.faculty || !Number.isFinite(payload.classroom_id) || !payload.session_date || !payload.class_start_time || !payload.class_end_time || !Number.isFinite(payload.attendance_window) || payload.attendance_window <= 0) {
        showToast("Complete all schedule fields before saving.", true);
        return;
      }

      try {
        await request(`/class-sessions/${editingSession.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload)
        });
        state.editingSessionId = null;
        await loadClassSessionsLive();
        await refreshClassroomsData();
        renderAdminSchedule();
        showToast("Class session updated.");
      } catch (err) {
        showToast(`Could not update class session: ${err.message}`, true);
      }
    });

    editPanel.querySelector("#cancelSessionEdit").addEventListener("click", () => {
      state.editingSessionId = null;
      renderAdminSchedule();
    });
  } else {
    editPanel.innerHTML = "<h4>Edit Scheduled Class</h4><p class=\"micro-note\">Choose a session from Class Schedule and click Edit Session to change time, faculty, classroom, or attendance window.</p>";
  }

  const form = formPanel.querySelector("#appointmentForm");
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const fd = new FormData(form);
    const entry = {
      title: String(fd.get("title")),
      faculty: String(fd.get("faculty")),
      classroom_id: Number(fd.get("classroom_id")),
      session_date: String(fd.get("session_date")),
      class_start_time: String(fd.get("class_start_time")),
      class_end_time: String(fd.get("class_end_time")),
      attendance_window: Number(fd.get("attendance_window"))
    };

    if (!Number.isFinite(entry.classroom_id) || !entry.session_date || !entry.class_start_time || !entry.class_end_time || !Number.isFinite(entry.attendance_window) || entry.attendance_window <= 0) {
      showToast("Complete classroom, date, start/end time, and attendance window.", true);
      return;
    }

    request("/class-sessions", {
      method: "POST",
      body: JSON.stringify(entry)
    }).then(async () => {
      await loadClassSessionsLive();
      await refreshClassroomsData();
      renderAdminSchedule();
      showToast("Class session scheduled.");
      form.reset();
    }).catch((err) => {
      showToast(`Could not schedule class: ${err.message}`, true);
    });
  });

  el.pageMount.appendChild(formPanel);
  el.pageMount.appendChild(listPanel);
  el.pageMount.appendChild(editPanel);
}

function renderAdminStudents() {
  const selected = state.data.students.find((s) => s.id === state.selectedStudentId) || state.data.students[0] || null;
  const records = selected ? getRecordsForUser(selected.id) : [];
  const assignedClassrooms = selected ? (state.enrollmentsByUser[selected.id] || []) : [];
  const classroomChoices = getClassroomOptions();

  el.pageMount.innerHTML = "";

  const createPanel = document.createElement("article");
  createPanel.className = "panel";
  createPanel.innerHTML = `
    <h4>Create Student Account</h4>
    <form id="createStudentForm" class="quick-form">
      <div class="split-2">
        <input name="name" placeholder="Student Name" maxlength="100" required />
        <input name="email" type="email" placeholder="student@college.edu" autocomplete="email" required />
      </div>
      <div class="split-2">
        <input name="password" type="password" placeholder="Temporary Password (min 6 chars)" autocomplete="new-password" minlength="6" required />
        <input value="student" disabled />
      </div>
      <button type="submit" class="btn-primary">Create Student</button>
      <p class="micro-note">Student self-registration is disabled. Admin creates all student accounts.</p>
    </form>
  `;

  const createForm = createPanel.querySelector("#createStudentForm");
  createForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const fd = new FormData(createForm);
    const name = String(fd.get("name") || "").trim();
    const email = String(fd.get("email") || "").trim().toLowerCase();
    const password = String(fd.get("password") || "").trim();

    if (!name || !email || password.length < 6) {
      showToast("Name, email, and password (min 6 chars) are required.", true);
      return;
    }

    try {
      const created = await request("/users", {
        method: "POST",
        body: JSON.stringify({
          name,
          email,
          password,
          role: "student"
        })
      });

      await loadStudentsLive();
      state.selectedStudentId = Number(created.id);
      persistSession();
      await ensureAttendanceLoadedFor(state.selectedStudentId);
      showToast(`Student account created for ${created.email}.`);
      renderAdminStudents();
    } catch (err) {
      showToast(`Could not create student: ${err.message}`, true);
    }
  });

  const topPanel = document.createElement("article");
  topPanel.className = "panel";
  topPanel.innerHTML = "<h4>Student Access Panel</h4>";

  const picker = document.createElement("div");
  picker.className = "toolbar";
  picker.innerHTML = `<span class="chip">Admin can inspect all students</span>`;

  const select = document.createElement("select");
  state.data.students.forEach((s) => {
    const option = document.createElement("option");
    option.value = String(s.id);
    option.textContent = `${s.name} (${s.department} - Sem ${s.semester})`;
    option.selected = !!selected && s.id === selected.id;
    select.appendChild(option);
  });
  select.addEventListener("change", async () => {
    state.selectedStudentId = Number(select.value);
    persistSession();
    await ensureEnrollmentsLoadedFor(state.selectedStudentId);
    await ensureAttendanceLoadedFor(state.selectedStudentId);
    renderAdminStudents();
  });
  if (!state.data.students.length) {
    select.disabled = true;
  }
  picker.appendChild(select);

  const exportBtn = document.createElement("button");
  exportBtn.className = "btn-inline";
  exportBtn.type = "button";
  exportBtn.textContent = "Export CSV";
  exportBtn.disabled = !selected;
  exportBtn.addEventListener("click", () => exportAttendanceCsv(selected, records));
  picker.appendChild(exportBtn);

  const setPasswordBtn = document.createElement("button");
  setPasswordBtn.className = "btn-inline";
  setPasswordBtn.type = "button";
  setPasswordBtn.textContent = "Set Password";
  setPasswordBtn.disabled = !selected;
  setPasswordBtn.addEventListener("click", async () => {
    await openSetPasswordDialog(selected);
  });
  picker.appendChild(setPasswordBtn);

  const assignClassroomBtn = document.createElement("button");
  assignClassroomBtn.className = "btn-inline";
  assignClassroomBtn.type = "button";
  assignClassroomBtn.textContent = "Assign Classroom";
  assignClassroomBtn.disabled = !selected || !classroomChoices.length;
  assignClassroomBtn.addEventListener("click", async () => {
    if (!selected) {
      showToast("Select a student first.", true);
      return;
    }

    if (!classroomChoices.length) {
      showToast("No classrooms available to assign.", true);
      return;
    }

    const classroomOptions = classroomChoices
      .map((c) => `${c.id}: ${c.name}`)
      .join("\n");
    const input = window.prompt(`Enter classroom ID to assign:\n${classroomOptions}`);
    if (input === null) {
      return;
    }

    const classroomId = Number(input);
    if (!Number.isFinite(classroomId)) {
      showToast("Enter a valid classroom ID.", true);
      return;
    }

    try {
      await request("/enrollments", {
        method: "POST",
        body: JSON.stringify({ user_id: selected.id, classroom_id: classroomId })
      });
      await ensureEnrollmentsLoadedFor(selected.id, true);
      showToast(`Assigned ${selected.name} to classroom ${classroomId}.`);
      renderAdminStudents();
    } catch (err) {
      showToast(`Could not assign classroom: ${err.message}`, true);
    }
  });
  picker.appendChild(assignClassroomBtn);

  topPanel.appendChild(picker);

  const summary = document.createElement("p");
  summary.className = "meta";
  summary.textContent = selected
    ? `${selected.email} • ${records.length} total records • ${calcAttendancePercent(records)}% attendance • ${assignedClassrooms.length} classroom assignment(s)`
    : "No student accounts yet. Create the first student account above.";
  topPanel.appendChild(summary);

  const assignmentPanel = document.createElement("article");
  assignmentPanel.className = "panel";
  assignmentPanel.innerHTML = "<h4>Assignment Manager</h4>";

  if (!selected) {
    assignmentPanel.innerHTML += '<div class="empty-state">Select a student to manage classroom assignments.</div>';
  } else {
    const assignmentToolbar = document.createElement("div");
    assignmentToolbar.className = "toolbar";

    const filterLabel = document.createElement("span");
    filterLabel.className = "chip";
    filterLabel.textContent = "Filter by classroom";
    assignmentToolbar.appendChild(filterLabel);

    const classroomFilter = document.createElement("select");
    const allOption = document.createElement("option");
    allOption.value = "all";
    allOption.textContent = "All Classrooms";
    classroomFilter.appendChild(allOption);
    classroomChoices.forEach((c) => {
      const option = document.createElement("option");
      option.value = String(c.id);
      option.textContent = c.name;
      classroomFilter.appendChild(option);
    });
    assignmentToolbar.appendChild(classroomFilter);

    const assignmentTableWrap = document.createElement("div");

    const renderAssignments = () => {
      const filterValue = classroomFilter.value;
      const filteredAssignments = filterValue === "all"
        ? assignedClassrooms
        : assignedClassrooms.filter((row) => Number(row.classroom_id) === Number(filterValue));

      assignmentTableWrap.innerHTML = "";
      if (!filteredAssignments.length) {
        assignmentTableWrap.innerHTML = '<div class="empty-state">No assignments match this filter.</div>';
        return;
      }

      assignmentTableWrap.appendChild(makeEnrollmentTable(filteredAssignments, async (enrollment) => {
        try {
          await request(`/enrollments/${enrollment.id}`, { method: "DELETE" });
          await ensureEnrollmentsLoadedFor(selected.id, true);
          showToast("Classroom assignment removed.");
          renderAdminStudents();
        } catch (err) {
          showToast(`Could not remove assignment: ${err.message}`, true);
        }
      }));
    };

    classroomFilter.addEventListener("change", renderAssignments);
    renderAssignments();

    assignmentPanel.appendChild(assignmentToolbar);
    assignmentPanel.appendChild(assignmentTableWrap);
  }

  const tablePanel = document.createElement("article");
  tablePanel.className = "panel";
  tablePanel.innerHTML = "<h4>Attendance History (Admin Editable)</h4>";
  if (!records.length) {
    tablePanel.innerHTML += '<div class="empty-state">No attendance records found for this student yet.</div>';
  } else {
    tablePanel.appendChild(makeAdminStudentTable(selected, records));
  }

  const info = document.createElement("div");
  info.className = "info-banner";
  info.textContent = selected && assignedClassrooms.length
    ? `Assigned classrooms: ${assignedClassrooms.map((r) => resolveClassroomName(r.classroom_id)).join(", ")}`
    : "No classroom assignments found for selected student. Attendance correction is allowed only within 7 days.";

  el.pageMount.appendChild(createPanel);
  el.pageMount.appendChild(topPanel);
  el.pageMount.appendChild(assignmentPanel);
  el.pageMount.appendChild(tablePanel);
  el.pageMount.appendChild(info);
}

function renderAdminClassrooms() {
  const classroomChoices = getClassroomOptions();
  const editingClassroom = classroomChoices.find((row) => Number(row.id) === Number(state.editingClassroomId)) || null;

  el.pageMount.innerHTML = "";

  const createPanel = document.createElement("article");
  createPanel.className = "panel";
  createPanel.innerHTML = `
    <h4>Create Classroom</h4>
    <form id="createClassroomForm" class="quick-form">
      <div class="split-2">
        <input name="name" placeholder="Classroom Name" maxlength="150" required />
        <input name="latitude" type="number" step="any" placeholder="Latitude" required />
      </div>
      <div class="split-2">
        <input name="longitude" type="number" step="any" placeholder="Longitude" required />
        <input name="radius" type="number" step="1" min="1" placeholder="Radius (meters)" required />
      </div>
      <button type="submit" class="btn-primary">Create Classroom</button>
      <p class="micro-note">Classroom stores location and BSSID only. Timing belongs to Class Schedule sessions.</p>
    </form>
  `;

  createPanel.querySelector("#createClassroomForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);

    const payload = {
      name: String(fd.get("name") || "").trim(),
      latitude: Number(fd.get("latitude")),
      longitude: Number(fd.get("longitude")),
      radius: Number(fd.get("radius"))
    };

    if (!payload.name) {
      showToast("Classroom name is required.", true);
      return;
    }
    if (!Number.isFinite(payload.latitude) || !Number.isFinite(payload.longitude)) {
      showToast("Valid latitude and longitude are required.", true);
      return;
    }
    if (!Number.isFinite(payload.radius) || payload.radius <= 0) {
      showToast("Radius must be greater than 0.", true);
      return;
    }
    try {
      await request("/classrooms", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      await refreshClassroomsData();
      renderAdminClassrooms();
      showToast(`Classroom ${payload.name} created.`);
    } catch (err) {
      showToast(`Could not create classroom: ${err.message}`, true);
    }
  });

  const wifiPanel = document.createElement("article");
  wifiPanel.className = "panel";
  wifiPanel.innerHTML = `
    <h4>Register Required BSSID</h4>
    <form id="createWifiForm" class="quick-form">
      <div class="split-2">
        <select name="classroom_id" required>
          <option value="">Select Classroom</option>
          ${classroomChoices.map((row) => `<option value="${row.id}">${row.name} (#${row.id})</option>`).join("")}
        </select>
        <input name="bssid" placeholder="AA:BB:CC:DD:EE:FF" maxlength="100" required />
      </div>
      <button type="submit" class="btn-primary">Register BSSID</button>
      <p class="micro-note">Android attendance app must match this classroom BSSID.</p>
    </form>
  `;

  wifiPanel.querySelector("#createWifiForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const fd = new FormData(event.currentTarget);

    const classroomId = Number(fd.get("classroom_id"));
    const bssid = String(fd.get("bssid") || "").trim().toUpperCase();

    if (!Number.isFinite(classroomId)) {
      showToast("Select a classroom before registering BSSID.", true);
      return;
    }
    if (!bssid) {
      showToast("BSSID is required.", true);
      return;
    }

    try {
      const created = await request("/wifi", {
        method: "POST",
        body: JSON.stringify({ classroom_id: classroomId, bssid })
      });

      state.recentWifiRegistrations.unshift({
        id: created.id,
        classroom_id: created.classroom_id || classroomId,
        bssid: created.bssid || bssid,
        created_at: created.created_at || new Date().toISOString()
      });
      state.recentWifiRegistrations = state.recentWifiRegistrations.slice(0, 50);
      renderAdminClassrooms();
      showToast(`BSSID registered for classroom ${classroomId}.`);
    } catch (err) {
      showToast(`Could not register BSSID: ${err.message}`, true);
    }
  });

  const tablePanel = document.createElement("article");
  tablePanel.className = "panel";
  tablePanel.innerHTML = "<h4>Classroom Catalog</h4>";
  if (!classroomChoices.length) {
    tablePanel.innerHTML += '<div class="empty-state">No classrooms found. Create the first classroom above.</div>';
  } else {
    tablePanel.appendChild(makeClassroomMasterTable(classroomChoices, (classroomId) => {
      state.editingClassroomId = Number(classroomId);
      renderAdminClassrooms();
    }));
  }

  const editPanel = document.createElement("article");
  editPanel.className = "panel";
  if (editingClassroom) {
    editPanel.innerHTML = `
      <h4>Edit Classroom</h4>
      <form id="editClassroomForm" class="quick-form">
        <div class="split-2">
          <input name="name" placeholder="Classroom Name" maxlength="150" required value="${escapeAttr(editingClassroom.name || "")}" />
          <input name="latitude" type="number" step="any" placeholder="Latitude" required value="${editingClassroom.latitude ?? ""}" />
        </div>
        <div class="split-2">
          <input name="longitude" type="number" step="any" placeholder="Longitude" required value="${editingClassroom.longitude ?? ""}" />
          <input name="radius" type="number" step="1" min="1" placeholder="Radius (meters)" required value="${editingClassroom.radius ?? ""}" />
        </div>
        <div class="toolbar">
          <button type="submit" class="btn-primary">Save Classroom Changes</button>
          <button type="button" class="btn-inline" id="cancelClassroomEdit">Cancel</button>
        </div>
      </form>
      <p class="micro-note">You can change classroom name, geolocation, and radius anytime.</p>
    `;

    const editForm = editPanel.querySelector("#editClassroomForm");
    editForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const fd = new FormData(editForm);

      const payload = {
        name: String(fd.get("name") || "").trim(),
        latitude: Number(fd.get("latitude")),
        longitude: Number(fd.get("longitude")),
        radius: Number(fd.get("radius"))
      };

      if (!payload.name) {
        showToast("Classroom name is required.", true);
        return;
      }
      if (!Number.isFinite(payload.latitude) || !Number.isFinite(payload.longitude)) {
        showToast("Valid latitude and longitude are required.", true);
        return;
      }
      if (!Number.isFinite(payload.radius) || payload.radius <= 0) {
        showToast("Radius must be greater than 0.", true);
        return;
      }

      try {
        await request(`/classrooms/${editingClassroom.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload)
        });
        state.editingClassroomId = null;
        await refreshClassroomsData();
        renderAdminClassrooms();
        showToast("Classroom updated.");
      } catch (err) {
        showToast(`Could not update classroom: ${err.message}`, true);
      }
    });

    editPanel.querySelector("#cancelClassroomEdit").addEventListener("click", () => {
      state.editingClassroomId = null;
      renderAdminClassrooms();
    });
  } else {
    editPanel.innerHTML = '<h4>Edit Classroom</h4><p class="micro-note">Click Edit in Classroom Catalog to update radius or other details.</p>';
  }

  const recentWifiPanel = document.createElement("article");
  recentWifiPanel.className = "panel";
  recentWifiPanel.innerHTML = "<h4>Recent BSSID Registrations</h4>";
  if (!state.recentWifiRegistrations.length) {
    recentWifiPanel.innerHTML += '<div class="empty-state">No BSSID registrations in this web session yet.</div>';
  } else {
    recentWifiPanel.appendChild(makeRecentWifiTable(state.recentWifiRegistrations));
  }

  el.pageMount.appendChild(createPanel);
  el.pageMount.appendChild(wifiPanel);
  el.pageMount.appendChild(tablePanel);
  el.pageMount.appendChild(editPanel);
  el.pageMount.appendChild(recentWifiPanel);
}

function makeEnrollmentTable(rows, onRemove) {
  const table = document.createElement("table");
  table.className = "table";
  table.innerHTML = "<thead><tr><th>Classroom</th><th>Assigned At</th><th>Action</th></tr></thead>";

  const tbody = document.createElement("tbody");
  rows.forEach((row) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${resolveClassroomName(row.classroom_id)}</td>
      <td>${formatDateTime(row.assigned_at)}</td>
      <td><button class="btn-inline" type="button">Unassign</button></td>
    `;
    tr.querySelector("button").addEventListener("click", () => onRemove(row));
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  return table;
}

function renderAdminAttendanceControl() {
  el.pageMount.innerHTML = "";
  const selectedClassroom = findClassroomById(state.selectedClassroomId);
  const classroomSessions = state.classroomsToday.filter((row) => Number(row.classroom_id) === Number(state.selectedClassroomId));
  const selectedSession = classroomSessions.find((row) => row.markable_now)
    || classroomSessions.sort((a, b) => {
      if ((a.session_date || "") !== (b.session_date || "")) {
        return String(b.session_date || "").localeCompare(String(a.session_date || ""));
      }
      return String(b.class_start_time || "").localeCompare(String(a.class_start_time || ""));
    })[0]
    || null;

  const settingsPanel = document.createElement("article");
  settingsPanel.className = "panel";
  settingsPanel.innerHTML = `
    <h4>Attendance Policy Snapshot</h4>
    <form id="settingsForm" class="quick-form">
      <div class="split-2">
        <div>
          <label class="field-label">Attendance Radius (meters)</label>
          <input name="radius" value="${selectedClassroom && selectedClassroom.radius ? selectedClassroom.radius : "-"}" disabled />
        </div>
        <div>
          <label class="field-label">Window (minutes)</label>
          <input name="window" value="${selectedSession && selectedSession.attendance_window ? selectedSession.attendance_window : "-"}" disabled />
        </div>
      </div>
      <label class="field-label">Class Start Time</label>
      <input name="start_time" value="${selectedSession && selectedSession.class_start_time ? selectedSession.class_start_time : "-"}" disabled />
      <label class="field-label">Class End Time</label>
      <input name="end_time" value="${selectedSession && selectedSession.class_end_time ? selectedSession.class_end_time : "-"}" disabled />
      <label class="field-label">Required BSSID</label>
      <input name="bssid" value="Configured via Classroom Master" disabled />
      <button class="btn-primary" type="submit">Acknowledge Snapshot</button>
      <p class="micro-note" id="saveNote">Use Classroom Master to create classrooms and register BSSID values.</p>
    </form>
  `;
  settingsPanel.querySelector("#settingsForm").addEventListener("submit", (event) => {
    event.preventDefault();
    settingsPanel.querySelector("#saveNote").textContent =
      "Policy snapshot saved in this web view. Android app remains source of attendance marking.";
    showToast("Policy snapshot saved.");
  });

  const roomPanel = document.createElement("article");
  roomPanel.className = "panel";
  roomPanel.innerHTML = "<h4>Classroom Attendance Feed</h4>";

  const toolbar = document.createElement("div");
  toolbar.className = "toolbar";

  const classroomSelect = document.createElement("select");
  getClassroomOptions().forEach((c) => {
    const option = document.createElement("option");
    option.value = String(c.id);
    option.textContent = `${c.name} (${c.markable_now ? "Live" : "Closed"})`;
    option.selected = c.id === state.selectedClassroomId;
    classroomSelect.appendChild(option);
  });
  classroomSelect.addEventListener("change", async () => {
    state.selectedClassroomId = Number(classroomSelect.value);
    await ensureClassroomAttendanceLoaded(state.selectedClassroomId);
    renderAdminAttendanceControl();
  });

  const refreshBtn = document.createElement("button");
  refreshBtn.className = "btn-inline";
  refreshBtn.type = "button";
  refreshBtn.textContent = "Refresh Feed";
  refreshBtn.addEventListener("click", async () => {
    await ensureClassroomAttendanceLoaded(state.selectedClassroomId, true);
    await refreshClassroomsData();
    renderAdminAttendanceControl();
    showToast("Classroom feed refreshed.");
  });

  toolbar.appendChild(classroomSelect);
  toolbar.appendChild(refreshBtn);
  roomPanel.appendChild(toolbar);

  if (!classroomSelect.options.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No classrooms available. Create one from Classroom Master first.";
    roomPanel.appendChild(empty);
    el.pageMount.appendChild(settingsPanel);
    el.pageMount.appendChild(roomPanel);
    return;
  }

  const rows = state.attendanceByClassroom[state.selectedClassroomId] || [];
  if (!rows.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No attendance events in selected classroom yet.";
    roomPanel.appendChild(empty);
  } else {
    roomPanel.appendChild(makeClassroomRecordsTable(rows));
  }

  el.pageMount.appendChild(settingsPanel);
  el.pageMount.appendChild(roomPanel);
}

function renderStudentOverview(fromDateValue = null, toDateValue = null) {
  const studentId = state.user ? state.user.id : state.selectedStudentId;
  const records = getRecordsForUser(studentId);
  const attendancePct = calcAttendancePercent(records);
  const weekTotal = records.length;
  const presentCount = records.filter((r) => normalizeStatus(r.status) === "present").length;
  const assignedClassrooms = state.enrollmentsByUser[studentId] || [];
  const savedRange = state.attendanceRange || {};
  const initialFrom = fromDateValue || savedRange.from || getDefaultRangeFrom();
  const initialTo = toDateValue || savedRange.to || new Date().toISOString().slice(0, 10);
  const rangeSummary = buildAttendanceRangeSummary(records, initialFrom, initialTo);

  const kpis = [
    { label: "Overall Attendance", value: `${attendancePct}%`, foot: "Live hour-wise attendance" },
    { label: "Total Marked Sessions", value: String(records.length), foot: `${presentCount} present entries` },
    { label: "Assigned Classrooms", value: String(assignedClassrooms.length), foot: "Enrollment-based access" },
    { label: "Range Attendance", value: `${rangeSummary.percentage}%`, foot: `${rangeSummary.present} attended of ${rangeSummary.total} classes ${rangeSummary.rangeLabel}` }
  ];

  el.pageMount.innerHTML = "";
  el.pageMount.appendChild(renderKPIs(kpis));

  const layout = document.createElement("section");
  layout.className = "layout-2";

  const profilePanel = document.createElement("article");
  profilePanel.className = "panel";
  profilePanel.innerHTML = `
    <h4>My Profile</h4>
    <div class="timeline">
      <div class="timeline-item"><strong>Name:</strong> ${state.user ? state.user.name : "-"}</div>
      <div class="timeline-item"><strong>Email:</strong> ${state.user ? state.user.email : "-"}</div>
      <div class="timeline-item"><strong>Role:</strong> Student</div>
      <div class="timeline-item"><strong>Marked Sessions:</strong> ${records.length}</div>
    </div>
  `;

  const attendancePanel = document.createElement("article");
  attendancePanel.className = "panel";
  const rangeControls = `
    <form id="rangeAttendanceForm" class="quick-form">
      <div class="split-2">
        <div>
          <label class="field-label">From</label>
          <input name="fromDate" type="date" required />
        </div>
        <div>
          <label class="field-label">To</label>
          <input name="toDate" type="date" required />
        </div>
      </div>
      <button class="btn-inline" type="submit">Apply Range</button>
    </form>
  `;
  attendancePanel.innerHTML = `
    <h4>My Attendance (Hour-wise)</h4>
    ${rangeControls}
    <div class="timeline">
      <div class="timeline-item"><strong>Overall:</strong> ${attendancePct}%</div>
      <div class="timeline-item"><strong>Present:</strong> ${presentCount}</div>
      <div class="timeline-item"><strong>Absent:</strong> ${Math.max(weekTotal - presentCount, 0)}</div>
      <div class="timeline-item"><strong>Range:</strong> ${rangeSummary.rangeLabel}</div>
    </div>
  `;

  const rangeForm = attendancePanel.querySelector("#rangeAttendanceForm");
  const fromInput = rangeForm.querySelector('[name="fromDate"]');
  const toInput = rangeForm.querySelector('[name="toDate"]');
  fromInput.value = initialFrom;
  toInput.value = initialTo;

  rangeForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (fromInput.value > toInput.value) {
      showToast("From date must be earlier than or equal to To date.", true);
      return;
    }
    state.attendanceRange = { from: fromInput.value, to: toInput.value };
    localStorage.setItem(STORAGE_KEYS.attendanceRange, JSON.stringify(state.attendanceRange));
    renderStudentOverview(fromInput.value, toInput.value);
  });

  layout.appendChild(profilePanel);
  layout.appendChild(attendancePanel);
  el.pageMount.appendChild(layout);
}

function renderStudentCourses() {
  const studentId = state.user ? state.user.id : state.selectedStudentId;
  const assigned = state.enrollmentsByUser[studentId] || [];

  el.pageMount.innerHTML = "";

  const panel = document.createElement("article");
  panel.className = "panel";
  panel.innerHTML = "<h4>My Courses</h4>";

  if (!assigned.length) {
    panel.innerHTML += '<div class="empty-state">No classrooms/courses assigned yet. Contact admin.</div>';
    el.pageMount.appendChild(panel);
    return;
  }

  const table = document.createElement("table");
  table.className = "table";
  table.innerHTML = "<thead><tr><th>Course / Classroom</th><th>Attendance Window</th><th>Class Start</th><th>Class End</th></tr></thead>";
  const tbody = document.createElement("tbody");

  assigned.forEach((row) => {
    const classroom = findClassroomById(row.classroom_id);
    const session = state.classSessions.find((s) => Number(s.classroom_id) === Number(row.classroom_id));
    const win = (session && session.attendance_window) || (classroom && classroom.attendance_window);
    const start = (session && session.class_start_time) || (classroom && classroom.class_start_time);
    const end = (session && session.class_end_time) || (classroom && classroom.class_end_time);
    const faculty = session && session.faculty && session.faculty !== "-" ? ` - Prof. ${session.faculty}` : "";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${session && session.title ? `${session.title}${faculty} (${resolveClassroomName(row.classroom_id)})` : resolveClassroomName(row.classroom_id)}</td>
      <td>${win ? `${win} mins` : "-"}</td>
      <td>${start ? start : "-"}</td>
      <td>${end ? end : "-"}</td>
    `;
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  panel.appendChild(table);
  el.pageMount.appendChild(panel);
}

function renderStudentTimetable() {
  const studentId = state.user ? state.user.id : state.selectedStudentId;
  const assigned = state.enrollmentsByUser[studentId] || [];

  el.pageMount.innerHTML = "";
  const panel = document.createElement("article");
  panel.className = "panel";
  panel.innerHTML = "<h4>Weekly Timetable</h4>";

  if (!assigned.length) {
    panel.innerHTML += '<div class="empty-state">No timetable available because no classrooms are assigned yet.</div>';
    el.pageMount.appendChild(panel);
    return;
  }

  const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const table = document.createElement("table");
  table.className = "table";
  table.innerHTML = "<thead><tr><th>Day / Hour</th><th>Hour 1</th><th>Hour 2</th><th>Hour 3</th><th>Hour 4</th><th>Hour 5</th><th>Hour 6</th><th>Hour 7</th><th>Hour 8</th></tr></thead>";
  const tbody = document.createElement("tbody");

  const assignedNames = assigned.map((row) => resolveClassroomName(row.classroom_id));

  weekdays.forEach((day) => {
    const tr = document.createElement("tr");
    const cells = ['<td><strong>' + day + '</strong></td>'];
    for (let hour = 1; hour <= 8; hour += 1) {
      const idx = (hour - 1) % assignedNames.length;
      cells.push(`<td>${assignedNames[idx]}</td>`);
    }
    tr.innerHTML = cells.join("");
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  panel.appendChild(table);
  el.pageMount.appendChild(panel);
}

function renderStudentDailyAttendance() {
  const studentId = state.user ? state.user.id : state.selectedStudentId;
  const records = getRecordsForUser(studentId);

  el.pageMount.innerHTML = "";

  const filterPanel = document.createElement("article");
  filterPanel.className = "panel";
  filterPanel.innerHTML = `
    <h4>Daily Attendance</h4>
    <form id="studentDailyFilter" class="quick-form">
      <div class="split-2">
        <input type="date" name="fromDate" required />
        <input type="date" name="toDate" required />
      </div>
      <div class="toolbar">
        <button class="btn-inline" type="button" id="printDaily">Print</button>
        <button class="btn-inline" type="button" id="exportDaily">Export</button>
        <button class="btn-primary" type="submit">Search</button>
      </div>
    </form>
  `;

  const tablePanel = document.createElement("article");
  tablePanel.className = "panel";
  tablePanel.innerHTML = "<h4>Hour-wise Attendance</h4>";

  const form = filterPanel.querySelector("#studentDailyFilter");
  const fromInput = form.querySelector('[name="fromDate"]');
  const toInput = form.querySelector('[name="toDate"]');

  const now = new Date();
  const from = new Date(now);
  from.setDate(now.getDate() - 30);
  fromInput.value = toInput.value = "";
  fromInput.valueAsDate = from;
  toInput.valueAsDate = now;

  const renderFiltered = () => {
    const fromDate = fromInput.value ? new Date(fromInput.value + "T00:00:00") : null;
    const toDate = toInput.value ? new Date(toInput.value + "T23:59:59") : null;

    const filtered = records.filter((r) => {
      const t = new Date(r.marked_at || r.date);
      if (Number.isNaN(t.getTime())) {
        return false;
      }
      if (fromDate && t < fromDate) {
        return false;
      }
      if (toDate && t > toDate) {
        return false;
      }
      return true;
    });

    tablePanel.innerHTML = "<h4>Hour-wise Attendance</h4>";
    if (!filtered.length) {
      tablePanel.innerHTML += '<div class="empty-state">No attendance data found for selected date range.</div>';
      return;
    }

    tablePanel.appendChild(makeDailyAttendanceHourTable(filtered));
  };

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    renderFiltered();
  });

  filterPanel.querySelector("#printDaily").addEventListener("click", () => window.print());
  filterPanel.querySelector("#exportDaily").addEventListener("click", () => {
    const filteredRecords = records.filter((r) => {
      const t = new Date(r.marked_at || r.date);
      if (Number.isNaN(t.getTime())) {
        return false;
      }
      const fromDate = fromInput.value ? new Date(fromInput.value + "T00:00:00") : null;
      const toDate = toInput.value ? new Date(toInput.value + "T23:59:59") : null;
      if (fromDate && t < fromDate) {
        return false;
      }
      if (toDate && t > toDate) {
        return false;
      }
      return true;
    });
    exportAttendanceCsv(state.user, filteredRecords);
  });

  renderFiltered();
  el.pageMount.appendChild(filterPanel);
  el.pageMount.appendChild(tablePanel);
}

function renderStudentAnalytics() {
  const studentId = state.user ? state.user.id : state.selectedStudentId;
  const records = getRecordsForUser(studentId);
  const trend = buildTrend(records);
  const subjectData = buildSubjectStats(records);

  el.pageMount.innerHTML = "";

  const panel = document.createElement("article");
  panel.className = "panel";
  panel.innerHTML = '<h4>Monthly Trend</h4><div class="chart-wrap"><svg id="trendChart" viewBox="0 0 600 220"></svg></div>';

  const panel2 = document.createElement("article");
  panel2.className = "panel";
  panel2.innerHTML = '<h4>Course-wise Attendance</h4><div class="chart-wrap"><svg id="subjectChart" viewBox="0 0 600 220"></svg></div>';

  el.pageMount.appendChild(panel);
  el.pageMount.appendChild(panel2);

  drawLineChart(document.getElementById("trendChart"), trend);
  drawBarChart(document.getElementById("subjectChart"), subjectData);
}

function renderStudentHistory() {
  const studentId = state.user ? state.user.id : state.selectedStudentId;
  const records = getRecordsForUser(studentId);

  el.pageMount.innerHTML = "";
  const panel = document.createElement("article");
  panel.className = "panel";
  panel.innerHTML = "<h4>My Attendance History</h4>";

  if (!records.length) {
    panel.innerHTML += '<div class="empty-state">No attendance history found yet.</div>';
  } else {
    panel.appendChild(makeStudentHistoryTable(records));
  }
  el.pageMount.appendChild(panel);
}

function renderKPIs(items) {
  const grid = document.createElement("section");
  grid.className = "kpi-grid";
  items.forEach((item) => {
    const node = el.kpiCardTpl.content.cloneNode(true);
    node.querySelector(".kpi-label").textContent = item.label;
    node.querySelector(".kpi-value").textContent = item.value;
    node.querySelector(".kpi-foot").textContent = item.foot;
    grid.appendChild(node);
  });
  return grid;
}

function resolveApiBase() {
  const configured = typeof window.__API_BASE__ === "string" ? window.__API_BASE__.trim() : "";
  if (configured) {
    return configured.replace(/\/$/, "");
  }

  const { protocol, hostname, origin } = window.location;
  if (protocol === "file:") {
    return "http://127.0.0.1:8000";
  }

  if (hostname === "localhost" || hostname === "127.0.0.1") {
    if (origin.endsWith(":8000")) {
      return origin;
    }
    return "http://127.0.0.1:8000";
  }

  return origin.replace(/\/$/, "");
}

function makeAdminStudentTable(student, records) {
  const table = document.createElement("table");
  table.className = "table";
  table.setAttribute("aria-label", "Student attendance records");
  table.innerHTML = "<thead><tr><th>Marked At</th><th>Classroom</th><th>Status</th><th>Source</th><th>Action</th></tr></thead>";
  const tbody = document.createElement("tbody");

  records.forEach((row) => {
    const tr = document.createElement("tr");
    const source = row.override ? '<span class="chip warn">Manual Override</span>' : '<span class="chip ok">Android App</span>';
    tr.innerHTML = `
      <td>${formatDateTime(row.marked_at || row.date)}</td>
      <td>${resolveClassroomName(row.classroom_id)}</td>
      <td>${statusBadge(row.status)}</td>
      <td>${source}</td>
      <td><button class="btn-inline" type="button">Edit</button></td>
    `;
    tr.querySelector("button").addEventListener("click", () => openOverrideEditor(student, row));
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  return table;
}

function makeStudentHistoryTable(records) {
  const table = document.createElement("table");
  table.className = "table";
  table.setAttribute("aria-label", "Student attendance history");
  table.innerHTML = "<thead><tr><th>Date</th><th>Classroom</th><th>Status</th><th>Recorded By</th></tr></thead>";
  const tbody = document.createElement("tbody");

  records.forEach((row) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${formatDateTime(row.marked_at || row.date)}</td>
      <td>${resolveClassroomName(row.classroom_id)}</td>
      <td>${statusBadge(row.status)}</td>
      <td>${row.override ? "Admin Override" : "Android Attendance App"}</td>
    `;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  return table;
}

function makeDailyAttendanceHourTable(records) {
  const byDate = new Map();

  records.forEach((row) => {
    const when = new Date(row.marked_at || row.date);
    if (Number.isNaN(when.getTime())) {
      return;
    }
    const dateKey = when.toISOString().slice(0, 10);
    const current = byDate.get(dateKey) || Array(8).fill("-");
    const hour = when.getHours();
    const slot = Math.min(Math.max(hour - 7, 1), 8);
    const status = normalizeStatus(row.status) === "present" ? "P" : "A";
    current[slot - 1] = status;
    byDate.set(dateKey, current);
  });

  const sortedDates = Array.from(byDate.keys()).sort();
  const table = document.createElement("table");
  table.className = "table";
  table.setAttribute("aria-label", "Daily hour-wise attendance overview");
  table.innerHTML = "<thead><tr><th>Date</th><th>Hour 1</th><th>Hour 2</th><th>Hour 3</th><th>Hour 4</th><th>Hour 5</th><th>Hour 6</th><th>Hour 7</th><th>Hour 8</th></tr></thead>";

  const tbody = document.createElement("tbody");
  sortedDates.forEach((dateKey) => {
    const tr = document.createElement("tr");
    const slots = byDate.get(dateKey) || Array(8).fill("-");
    const cells = [`<td>${dateKey}</td>`];
    slots.forEach((value) => {
      const cssClass = value === "P" ? "chip ok" : value === "A" ? "chip warn" : "muted";
      cells.push(`<td><span class="${cssClass}">${value}</span></td>`);
    });
    tr.innerHTML = cells.join("");
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  return table;
}

function makeClassroomWindowTable(rows) {
  const table = document.createElement("table");
  table.className = "table";
  table.setAttribute("aria-label", "Class session attendance window status");
  table.innerHTML = "<thead><tr><th>Session</th><th>Classroom</th><th>Window</th><th>Markable</th><th>Schedule</th></tr></thead>";
  const tbody = document.createElement("tbody");

  rows.forEach((row) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${row.title || row.name}</td>
      <td>${row.classroom_name || resolveClassroomName(row.classroom_id)}</td>
      <td>${row.attendance_window || 20} mins</td>
      <td>${row.markable_now ? '<span class="badge ok">Open</span>' : '<span class="badge warn">Closed</span>'}</td>
      <td>${formatDateTime(row.session_date)}</td>
    `;
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  return table;
}

function makeClassroomRecordsTable(rows) {
  const table = document.createElement("table");
  table.className = "table";
  table.setAttribute("aria-label", "Classroom attendance feed");
  table.innerHTML = "<thead><tr><th>Marked At</th><th>User ID</th><th>Classroom ID</th><th>Status</th></tr></thead>";
  const tbody = document.createElement("tbody");

  rows.forEach((row) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${formatDateTime(row.marked_at || row.date)}</td>
      <td>${row.user_id}</td>
      <td>${row.classroom_id}</td>
      <td>${statusBadge(row.status)}</td>
    `;
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  return table;
}

function makeClassroomMasterTable(rows, onEdit) {
  const liveStatusById = new Map();
  state.classroomsToday.forEach((row) => {
    liveStatusById.set(Number(row.id), Boolean(row.markable_now));
  });

  const table = document.createElement("table");
  table.className = "table";
  table.setAttribute("aria-label", "Classroom master list");
  table.innerHTML = "<thead><tr><th>ID</th><th>Name</th><th>Geo Policy</th><th>Action</th></tr></thead>";

  const tbody = document.createElement("tbody");
  rows.forEach((row) => {
    const tr = document.createElement("tr");

    const lat = typeof row.latitude === "number" ? row.latitude.toFixed(6) : "-";
    const lon = typeof row.longitude === "number" ? row.longitude.toFixed(6) : "-";
    const radius = row.radius ? `${row.radius}m` : "-";

    tr.innerHTML = `
      <td>${row.id}</td>
      <td>${row.name}</td>
      <td>${lat}, ${lon} • ${radius}</td>
      <td>
        <div class="toolbar">
          <button class="btn-inline" type="button" data-action="feed">Use in Feed</button>
          <button class="btn-inline" type="button" data-action="edit">Edit</button>
        </div>
      </td>
    `;

    tr.querySelector('[data-action="feed"]').addEventListener("click", () => {
      state.selectedClassroomId = Number(row.id);
      state.page = "attendance";
      persistSession();
      renderNav();
      renderPage();
    });

    tr.querySelector('[data-action="edit"]').addEventListener("click", () => {
      if (typeof onEdit === "function") {
        onEdit(row.id);
      }
    });

    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  return table;
}

function makeRecentWifiTable(rows) {
  const table = document.createElement("table");
  table.className = "table";
  table.setAttribute("aria-label", "Recent WiFi BSSID registrations");
  table.innerHTML = "<thead><tr><th>Classroom</th><th>BSSID</th><th>Registered At</th></tr></thead>";

  const tbody = document.createElement("tbody");
  rows.forEach((row) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${resolveClassroomName(row.classroom_id)}</td>
      <td>${row.bssid}</td>
      <td>${formatDateTime(row.created_at)}</td>
    `;
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  return table;
}

function renderScheduleItem(appt) {
  const card = document.createElement("article");
  card.className = "appointment-card";
  const statusClass = appt.markable_now ? "ok" : "warn";
  card.innerHTML = `
    <div>
      <h4>${appt.title || appt.name}</h4>
      <p class="muted">${appt.session_date || "-"} • ${appt.class_start_time || "-"} - ${appt.class_end_time || "-"} • ${resolveClassroomName(appt.classroom_id)} • ${appt.faculty || "-"}</p>
    </div>
    <div><span class="badge ${statusClass}">${appt.markable_now ? "Open" : "Closed"}</span></div>
  `;
  return card;
}

function openOverrideEditor(student, row) {
  const form = document.createElement("form");
  form.className = "panel";
  form.innerHTML = `
    <h4>Update Attendance Record</h4>
    <div class="split-2">
      <div>
        <label class="field-label">Student</label>
        <input value="${student.name} (#${student.id})" disabled />
      </div>
      <div>
        <label class="field-label">Classroom</label>
        <input value="${resolveClassroomName(row.classroom_id)}" disabled />
      </div>
    </div>
    <label class="field-label">Status</label>
    <select name="status">
      <option value="Present" ${normalizeStatus(row.status) === "present" ? "selected" : ""}>Present</option>
      <option value="Absent" ${normalizeStatus(row.status) === "absent" ? "selected" : ""}>Absent</option>
    </select>
    <label class="field-label">Reason</label>
    <textarea name="reason" rows="3" maxlength="500" required placeholder="Faculty approved correction reason"></textarea>
    <div class="toolbar">
      <button class="btn-primary" type="submit">Save Override</button>
      <button class="btn-inline" type="button" id="cancelEdit">Cancel</button>
    </div>
  `;

  form.querySelector("#cancelEdit").addEventListener("click", () => renderAdminStudents());
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const fd = new FormData(form);
    const status = String(fd.get("status") || "").trim().toLowerCase();
    const reason = String(fd.get("reason")).trim();
    if (!reason) {
      showToast("Reason is mandatory for admin override.", true);
      return;
    }

    const attendanceId = Number(row.id);
    if (!Number.isFinite(attendanceId)) {
      showToast("Cannot correct this record because it is not a persisted attendance entry.", true);
      return;
    }

    try {
      await request(`/attendance/${attendanceId}/correct`, {
        method: "PATCH",
        body: JSON.stringify({ status, reason })
      });

      await ensureAttendanceLoadedFor(student.id, true);
      if (state.selectedClassroomId) {
        await ensureClassroomAttendanceLoaded(state.selectedClassroomId, true);
      }

      showToast("Attendance correction saved.");
      renderAdminStudents();
    } catch (err) {
      showToast(`Could not save correction: ${err.message}`, true);
    }
  });

  el.pageMount.innerHTML = "";
  el.pageMount.appendChild(form);
}

async function openSetPasswordDialog(student) {
  if (!student) {
    showToast("No student selected.", true);
    return;
  }

  const firstInput = window.prompt(
    `Set new password for ${student.name} (${student.email}). Minimum 6 characters.`
  );
  if (firstInput === null) {
    return;
  }

  const password = firstInput.trim();
  if (password.length < 6) {
    showToast("Password must be at least 6 characters.", true);
    return;
  }

  const confirmInput = window.prompt("Re-enter the new password to confirm.");
  if (confirmInput === null) {
    return;
  }

  if (confirmInput.trim() !== password) {
    showToast("Passwords do not match.", true);
    return;
  }

  try {
    await request(`/users/${student.id}/password`, {
      method: "PATCH",
      body: JSON.stringify({ password })
    });
    showToast(`Password updated for ${student.email}.`);
  } catch (err) {
    showToast(`Could not update password: ${err.message}`, true);
  }
}

async function ensureEnrollmentsLoadedFor(userId, forceReload = false) {
  if (!userId) {
    return;
  }
  if (!forceReload && state.enrollmentsByUser[userId]) {
    return;
  }

  try {
    const rows = await request(`/enrollments?user_id=${userId}`);
    state.enrollmentsByUser[userId] = Array.isArray(rows) ? rows : [];
  } catch {
    state.enrollmentsByUser[userId] = [];
  }
}

function getRecordsForUser(userId) {
  const base = state.attendanceByUser[userId] || [];
  const overrides = getAllOverrides().filter((item) => Number(item.user_id) === Number(userId));

  const byKey = new Map();
  base.forEach((row) => byKey.set(recordKey(row), row));
  overrides.forEach((row) => byKey.set(recordKey(row), { ...row, override: true }));

  return Array.from(byKey.values()).sort((a, b) => {
    const da = new Date(a.marked_at || a.date).getTime();
    const db = new Date(b.marked_at || b.date).getTime();
    return db - da;
  });
}

async function ensureAttendanceLoadedFor(userId, forceReload = false) {
  if (!userId || (!forceReload && state.attendanceByUser[userId])) {
    return;
  }
  try {
    const data = await request(`/attendance?user_id=${userId}`);
    state.attendanceByUser[userId] = decorateAttendance(data, userId);
    state.syncMode = "live";
  } catch {
    state.attendanceByUser[userId] = [];
    state.syncMode = "offline";
  }
}

async function ensureClassroomAttendanceLoaded(classroomId, forceReload = false) {
  if (!classroomId || (!forceReload && state.attendanceByClassroom[classroomId])) {
    return;
  }
  try {
    const data = await request(`/attendance?classroom_id=${classroomId}`);
    state.attendanceByClassroom[classroomId] = decorateClassroomRows(data, classroomId);
    state.syncMode = "live";
  } catch {
    state.attendanceByClassroom[classroomId] = [];
    state.syncMode = "offline";
  }
}

function decorateAttendance(data, userId) {
  if (!Array.isArray(data)) {
    return [];
  }
  return data.map((row) => ({
    ...row,
    user_id: row.user_id || userId,
    status: row.status || "Present",
    marked_at: row.marked_at || row.timestamp || row.date,
    date: row.marked_at || row.timestamp || row.date
  }));
}

function decorateClassroomRows(data, classroomId) {
  if (!Array.isArray(data)) {
    return [];
  }
  return data.map((row) => ({
    ...row,
    classroom_id: row.classroom_id || classroomId,
    status: row.status || "Present",
    marked_at: row.marked_at || row.timestamp || row.date,
    date: row.marked_at || row.timestamp || row.date
  }));
}

function normalizeClassrooms(data) {
  if (!Array.isArray(data)) {
    return [];
  }

  return data.map((row, index) => ({
    id: Number(row.id || row.classroom_id || index + 1),
    session_id: row.session_id ? Number(row.session_id) : null,
    name: row.name || `Classroom ${row.classroom_id || index + 1}`,
    attendance_window: row.attendance_window ?? null,
    latitude: typeof row.latitude === "number" ? row.latitude : null,
    longitude: typeof row.longitude === "number" ? row.longitude : null,
    radius: typeof row.radius === "number" ? row.radius : null,
    markable_now: typeof row.markable_now === "boolean" ? row.markable_now : Boolean(row.is_markable_now),
    created_at: row.created_at || new Date().toISOString(),
    class_start_time: row.class_start_time || null,
    class_end_time: row.class_end_time || null,
    classroom_name: row.classroom_name || null,
    title: row.title || null,
    session_date: row.session_date || null,
    status_note: row.status_note || null
  }));
}

function calcAttendancePercent(records) {
  if (!records.length) {
    return 0;
  }
  const present = records.filter((r) => normalizeStatus(r.status) === "present").length;
  return Math.round((present / records.length) * 100);
}

function buildAttendanceRangeSummary(records, fromDateValue = null, toDateValue = null) {
  const defaultTo = new Date();
  const defaultFrom = new Date(defaultTo);
  defaultFrom.setMonth(defaultTo.getMonth() - 4);

  const fromDate = fromDateValue ? new Date(`${fromDateValue}T00:00:00`) : defaultFrom;
  const toDate = toDateValue ? new Date(`${toDateValue}T23:59:59`) : defaultTo;

  const filtered = records.filter((record) => {
    const when = new Date(record.marked_at || record.date);
    if (Number.isNaN(when.getTime())) {
      return false;
    }
    return when >= fromDate && when <= toDate;
  });

  const total = filtered.length;
  const present = filtered.filter((record) => normalizeStatus(record.status) === "present").length;
  const percentage = total ? Math.round((present / total) * 100) : 0;
  const rangeLabel = `${formatShortDate(fromDate)} to ${formatShortDate(toDate)}`;

  return { total, present, percentage, rangeLabel };
}

function buildTrend(records) {
  if (!records.length) {
    return [];
  }
  const months = new Map();
  records.forEach((r) => {
    const d = new Date(r.marked_at || r.date);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    const val = months.get(key) || { total: 0, present: 0 };
    val.total += 1;
    if (normalizeStatus(r.status) === "present") {
      val.present += 1;
    }
    months.set(key, val);
  });
  const arr = Array.from(months.values()).map((m) => Math.round((m.present / m.total) * 100));
  return arr.slice(-8);
}

function buildSubjectStats(records) {
  const byClass = new Map();
  records.forEach((r) => {
    const name = resolveClassroomName(r.classroom_id);
    const cur = byClass.get(name) || { name, present: 0, total: 0 };
    cur.total += 1;
    if (normalizeStatus(r.status) === "present") {
      cur.present += 1;
    }
    byClass.set(name, cur);
  });

  const result = Array.from(byClass.values()).map((x) => ({
    name: x.name.length > 12 ? `${x.name.slice(0, 12)}.` : x.name,
    pct: Math.round((x.present / x.total) * 100)
  }));

  return result;
}

function drawLineChart(svg, values) {
  if (!values.length) {
    svg.innerHTML = '<text x="300" y="110" text-anchor="middle" fill="#9db0d2" font-size="13">No attendance trend data available yet</text>';
    return;
  }

  const width = 600;
  const height = 220;
  const pad = 26;
  const min = 60;
  const max = 100;
  const stepX = values.length > 1 ? (width - pad * 2) / (values.length - 1) : 1;

  const points = values
    .map((v, i) => {
      const x = pad + i * stepX;
      const y = height - pad - ((v - min) / (max - min)) * (height - pad * 2);
      return `${x},${y}`;
    })
    .join(" ");

  svg.innerHTML = `
    <defs>
      <linearGradient id="lineGrad" x1="0" x2="1" y1="0" y2="0">
        <stop offset="0%" stop-color="#36d399" />
        <stop offset="100%" stop-color="#2f9cff" />
      </linearGradient>
    </defs>
    <polyline fill="none" stroke="#35557b" stroke-width="1" points="${pad},${height - pad} ${width - pad},${height - pad}" />
    <polyline fill="none" stroke="url(#lineGrad)" stroke-width="4" points="${points}" stroke-linecap="round" stroke-linejoin="round" />
  `;
}

function drawBarChart(svg, subjects) {
  if (!subjects.length) {
    svg.innerHTML = '<text x="300" y="110" text-anchor="middle" fill="#9db0d2" font-size="13">No course-wise attendance data available yet</text>';
    return;
  }

  const width = 600;
  const height = 220;
  const pad = 30;
  const divisor = subjects.length || 1;
  const barW = Math.max(((width - pad * 2) / divisor) - 14, 16);
  let bars = "";

  subjects.forEach((s, i) => {
    const x = pad + i * (barW + 14);
    const h = Math.max((s.pct / 100) * (height - pad * 2), 4);
    const y = height - pad - h;
    bars += `
      <rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="7" fill="#2f9cff" opacity="0.78" />
      <text x="${x + barW / 2}" y="${height - 8}" text-anchor="middle" fill="#9db0d2" font-size="11">${s.name}</text>
      <text x="${x + barW / 2}" y="${y - 6}" text-anchor="middle" fill="#ecf2ff" font-size="11">${s.pct}%</text>
    `;
  });
  svg.innerHTML = bars;
}

function statusBadge(status) {
  return normalizeStatus(status) === "present"
    ? '<span class="badge ok">Present</span>'
    : '<span class="badge danger">Absent</span>';
}

function normalizeStatus(status) {
  return String(status || "present").toLowerCase();
}

function resolveClassroomName(classroomId) {
  const hit = findClassroomById(classroomId);
  return hit ? hit.name : `Classroom ${classroomId}`;
}

function getClassroomOptions() {
  if (state.classroomsCatalog.length) {
    return state.classroomsCatalog;
  }
  return state.classroomsToday;
}

function findClassroomById(classroomId) {
  const idNum = Number(classroomId);
  if (!Number.isFinite(idNum)) {
    return null;
  }

  const catalogHit = state.classroomsCatalog.find((c) => Number(c.id) === idNum);
  if (catalogHit) {
    return catalogHit;
  }

  return state.classroomsToday.find((c) => Number(c.id) === idNum) || null;
}

function formatDateTime(value) {
  if (!value) {
    return "-";
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    return String(value);
  }
  return d.toLocaleString("en-IN", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatShortDate(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) {
    return "-";
  }
  return d.toLocaleDateString("en-IN", {
    month: "short",
    day: "2-digit",
    year: "numeric"
  });
}

function recordKey(row) {
  return `${row.user_id || "u"}-${row.classroom_id || "c"}-${row.marked_at || row.timestamp || row.date || row.id || "r"}`;
}

function toInputTimeValue(value) {
  if (!value) {
    return "";
  }
  const text = String(value).trim();
  if (text.length >= 5) {
    return text.slice(0, 5);
  }
  return text;
}

function escapeAttr(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function getAllOverrides() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEYS.overrides) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function upsertOverride(entry) {
  const all = getAllOverrides();
  const key = recordKey(entry);
  const idx = all.findIndex((item) => recordKey(item) === key);
  if (idx >= 0) {
    all[idx] = entry;
  } else {
    all.push(entry);
  }
  localStorage.setItem(STORAGE_KEYS.overrides, JSON.stringify(all));
}

function saveSchedule(items) {
  localStorage.setItem(STORAGE_KEYS.appointments, JSON.stringify(items));
}

function loadSchedule() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEYS.appointments) || "[]");
    if (Array.isArray(parsed) && parsed.length) {
      return parsed;
    }
  } catch {
    // Ignore invalid persisted data.
  }
  return [];
}

function loadAttendanceRange() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEYS.attendanceRange) || "null");
    if (parsed && typeof parsed === "object") {
      return {
        from: typeof parsed.from === "string" ? parsed.from : null,
        to: typeof parsed.to === "string" ? parsed.to : null
      };
    }
  } catch {
    // Ignore invalid persisted data.
  }
  return { from: null, to: null };
}

function getDefaultRangeFrom() {
  const now = new Date();
  const from = new Date(now);
  from.setMonth(now.getMonth() - 4);
  return from.toISOString().slice(0, 10);
}

function exportAttendanceCsv(student, records) {
  const rows = [["student_id", "student_name", "classroom", "marked_at", "status", "source"]];
  records.forEach((r) => {
    rows.push([
      String(student.id),
      csvEscape(student.name),
      csvEscape(resolveClassroomName(r.classroom_id)),
      csvEscape(r.marked_at || r.date || ""),
      csvEscape(r.status || "Present"),
      csvEscape(r.override ? "Admin Override" : "Android App")
    ]);
  });

  const csv = rows.map((line) => line.join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${student.name.replace(/\s+/g, "_")}_attendance.csv`;
  link.click();
  URL.revokeObjectURL(url);
  showToast("CSV exported.");
}

function csvEscape(value) {
  const clean = String(value || "").replace(/"/g, '""');
  return `"${clean}"`;
}

function updateSyncPill() {
  if (!el.syncPill) {
    return;
  }

  el.syncPill.classList.remove("status-live", "status-demo", "status-offline");

  if (state.loading) {
    el.syncPill.textContent = "Syncing...";
    el.syncPill.classList.add("status-demo");
    return;
  }

  if (state.syncMode === "live") {
    el.syncPill.textContent = "Live API Sync";
    el.syncPill.classList.add("status-live");
    return;
  }

  if (state.syncMode === "offline") {
    el.syncPill.textContent = "Offline";
    el.syncPill.classList.add("status-offline");
    return;
  }

  el.syncPill.textContent = "No Live Data";
  el.syncPill.classList.add("status-demo");
}

function showToast(message, isError = false) {
  if (!el.toast) {
    return;
  }
  el.toast.textContent = message;
  el.toast.classList.remove("hidden", "error");
  if (isError) {
    el.toast.classList.add("error");
  }
  clearTimeout(state.messageTimer);
  state.messageTimer = setTimeout(() => {
    el.toast.classList.add("hidden");
  }, 2400);
}

function persistSession() {
  const payload = {
    currentRole: state.currentRole,
    page: state.page,
    user: state.user,
    selectedStudentId: state.selectedStudentId,
    expiresAt: state.sessionExpiresAt || Date.now() + SESSION_TTL_MS
  };
  localStorage.setItem(STORAGE_KEYS.session, JSON.stringify(payload));
}

function loadSession() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEYS.session) || "null");
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    if (typeof parsed.expiresAt !== "number") {
      parsed.expiresAt = Date.now() + SESSION_TTL_MS;
      localStorage.setItem(STORAGE_KEYS.session, JSON.stringify(parsed));
    }
    if (typeof parsed.expiresAt === "number" && Date.now() >= parsed.expiresAt) {
      clearExpiredSession();
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function scheduleSessionExpiry(expiresAt) {
  clearSessionTimer();
  if (!expiresAt || Number.isNaN(Number(expiresAt))) {
    return;
  }

  const delay = Number(expiresAt) - Date.now();
  if (delay <= 0) {
    clearExpiredSession();
    logout();
    return;
  }

  state.sessionTimer = setTimeout(() => {
    showToast("Session expired. Please sign in again.", true);
    logout();
  }, delay);
}

function clearSessionTimer() {
  if (state.sessionTimer) {
    clearTimeout(state.sessionTimer);
    state.sessionTimer = null;
  }
}

function clearExpiredSession() {
  localStorage.removeItem(STORAGE_KEYS.token);
  localStorage.removeItem(STORAGE_KEYS.session);
}

async function apiLogin(email, password) {
  return request("/users/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
    includeAuth: false
  });
}

async function request(path, options = {}) {
  const token = localStorage.getItem(STORAGE_KEYS.token);
  const includeAuth = options.includeAuth !== false;
  const headers = {
    "Content-Type": "application/json",
    ...(includeAuth && token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {})
  };

  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: "Unknown error" }));
    throw new Error(err.detail || `API error ${response.status}`);
  }
  const text = await response.text();
  return text ? JSON.parse(text) : {};
}
