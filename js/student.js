/* =========================================================
   AttendIT — Student Dashboard, History & QR Scanner
   ========================================================= */

import { db, ref, set, get, push } from "./firebase-init.js";
import {
  $,
  toast,
  show,
  hide,
  formatDate,
  formatTime,
  statusBadge,
  escHtml,
  barColor,
} from "./helpers.js";
import state from "./state.js";

/* ===========================================================
   INIT
   =========================================================== */
export function initStudentDashboard() {
  window._studentHistoryRows = [];
  window._subjects = {};

  renderApprovalState();

  if ((state.currentUserData?.approvalStatus || "approved") !== "approved") {
    resetStudentDashboardForApprovalState();
    return;
  }

  loadStudentStats();
  loadStudentHistory();
  loadStudentSubjects();
  loadStudentSchedule();
}

function renderApprovalState() {
  const card = $("#stu-approval-card");
  const message = $("#stu-approval-message");
  if (!card || !message) return;

  const status = state.currentUserData?.approvalStatus || "approved";
  if (status === "approved") {
    hide(card);
    message.className = "student-approval-message";
    message.textContent = "";
    return;
  }

  show(card);
  if (status === "pending") {
    message.className = "student-approval-message pending";
    message.innerHTML =
      '<i class="fas fa-hourglass-half"></i><div><strong>Waiting for approval</strong><p>Your teacher still needs to approve your signup based on your grade and section.</p></div>';
    return;
  }

  message.className = "student-approval-message rejected";
  message.innerHTML =
    '<i class="fas fa-times-circle"></i><div><strong>Signup not approved</strong><p>Your signup request was rejected. Please contact your teacher for correction.</p></div>';
}

function resetStudentDashboardForApprovalState() {
  window._studentHistoryRows = [];
  window._subjects = {};

  $("#stu-stat-present").textContent = "0";
  $("#stu-stat-late").textContent = "0";
  $("#stu-stat-absent").textContent = "0";
  $("#stu-stat-percentage").textContent = "0%";

  const subjects = $("#stu-subjects-summary");
  if (subjects) {
    subjects.innerHTML =
      '<div class="empty-state"><i class="fas fa-user-clock"></i><p>Your account must be approved before subjects are shown.</p></div>';
  }

  const schedule = $("#stu-schedule-summary");
  if (schedule) {
    schedule.innerHTML =
      '<div class="empty-state"><i class="fas fa-calendar-times"></i><p>Schedule will appear after teacher approval.</p></div>';
  }

  const historyBody = $("#history-tbody");
  if (historyBody) {
    historyBody.innerHTML =
      '<tr><td colspan="4" style="text-align:center;padding:24px;opacity:.6">Attendance history is available after approval.</td></tr>';
  }
}

/* ===========================================================
   STUDENT STATS
   =========================================================== */
async function loadStudentStats() {
  const attSnap = await get(ref(db, "attendance"));
  let present = 0,
    late = 0,
    absent = 0;

  if (attSnap.exists()) {
    Object.values(attSnap.val()).forEach((session) => {
      if (session[state.currentUser.uid]) {
        const st = session[state.currentUser.uid].status;
        if (st === "present") present++;
        else if (st === "late") late++;
        else absent++;
      }
    });
  }

  const total = present + late + absent;
  const pct = total ? Math.round(((present + late) / total) * 100) : 0;
  $("#stu-stat-present").textContent = present;
  $("#stu-stat-late").textContent = late;
  $("#stu-stat-absent").textContent = absent;
  $("#stu-stat-percentage").textContent = pct + "%";
}

/* ===========================================================
   ENROLLED SUBJECTS
   =========================================================== */
async function loadStudentSubjects() {
  const subjSnap = await get(ref(db, "subjects"));
  const container = $("#stu-subjects-summary");
  container.innerHTML = "";
  const histFilter = $("#history-subject-filter");
  histFilter.innerHTML = '<option value="">All Subjects</option>';

  if (!subjSnap.exists()) {
    container.innerHTML =
      '<div class="empty-state"><i class="fas fa-book-open"></i><p>No subjects found.<br>Ask your instructor to enroll you.</p></div>';
    return;
  }

  const subjects = subjSnap.val();
  const attSnap = await get(ref(db, "attendance"));
  const sessSnap = await get(ref(db, "sessions"));
  const sessions = sessSnap.exists() ? sessSnap.val() : {};
  let enrolledInAny = false;

  for (const subjId of Object.keys(subjects)) {
    const enrollSnap = await get(
      ref(db, `enrollments/${subjId}/${state.currentUser.uid}`),
    );
    if (!enrollSnap.exists()) continue;
    enrolledInAny = true;

    let total = 0,
      attended = 0;
    if (sessSnap.exists() && attSnap.exists()) {
      Object.entries(sessions).forEach(([sessId, sess]) => {
        if (sess.subjectId !== subjId) return;
        total++;
        const att = attSnap.val()?.[sessId]?.[state.currentUser.uid];
        if (att && (att.status === "present" || att.status === "late"))
          attended++;
      });
    }

    const pct = total ? Math.round((attended / total) * 100) : 100;
    const subj = subjects[subjId];

    const row = document.createElement("div");
    row.className = "subject-summary-row";
    row.innerHTML = `
      <div class="subject-summary-left">
        <span class="subject-name">${escHtml(subj.name)}</span>
        <span class="subject-code">${escHtml(subj.code || "")} &bull; ${escHtml(subj.schedule || "")}</span>
      </div>
      <div class="attendance-bar-wrap">
        <div class="attendance-bar"><div class="attendance-bar-fill" style="width:${pct}%;background:${barColor(pct)}"></div></div>
        <span class="attendance-pct" style="color:${barColor(pct)}">${pct}%</span>
      </div>`;
    container.appendChild(row);

    const opt = document.createElement("option");
    opt.value = subjId;
    opt.textContent = subj.name;
    histFilter.appendChild(opt);
  }

  if (!enrolledInAny)
    container.innerHTML =
      '<div class="empty-state"><i class="fas fa-book-open"></i><p>You are not enrolled in any subjects yet.<br>Ask your instructor to add you.</p></div>';
}

/* ===========================================================
   STUDENT SCHEDULE
   =========================================================== */
async function loadStudentSchedule() {
  const container = $("#stu-schedule-summary");
  if (!container) return;

  container.innerHTML = "";

  const subjSnap = await get(ref(db, "subjects"));
  if (!subjSnap.exists()) {
    container.innerHTML =
      '<div class="empty-state"><i class="fas fa-calendar-alt"></i><p>No schedule available yet</p></div>';
    return;
  }

  const entries = [];
  for (const [subjId, subj] of Object.entries(subjSnap.val())) {
    const enrollSnap = await get(
      ref(db, `enrollments/${subjId}/${state.currentUser.uid}`),
    );
    if (!enrollSnap.exists()) continue;

    entries.push({
      name: subj.name || "Untitled Subject",
      code: subj.code || "",
      schedule: subj.schedule || "Schedule not set",
      grade: subj.grade || state.currentUserData?.grade || "",
      section: subj.section || state.currentUserData?.section || "",
    });
  }

  if (!entries.length) {
    container.innerHTML =
      '<div class="empty-state"><i class="fas fa-calendar-times"></i><p>No schedule available. Ask your teacher to enroll you in your section classes.</p></div>';
    return;
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));
  entries.forEach((entry) => {
    const row = document.createElement("div");
    row.className = "schedule-row";
    row.innerHTML = `
      <div class="schedule-main">
        <span class="schedule-subject">${escHtml(entry.name)}</span>
        <span class="schedule-meta">${escHtml(entry.code)}${entry.code ? " • " : ""}${escHtml(entry.grade && entry.section ? `${entry.grade} Section ${entry.section}` : "")}</span>
      </div>
      <span class="schedule-time">${escHtml(entry.schedule)}</span>`;
    container.appendChild(row);
  });
}

/* ===========================================================
   ATTENDANCE HISTORY
   =========================================================== */
async function loadStudentHistory() {
  const attSnap = await get(ref(db, "attendance"));
  const sessSnap = await get(ref(db, "sessions"));
  const subjSnap = await get(ref(db, "subjects"));
  const tbody = $("#history-tbody");
  tbody.innerHTML = "";

  if (!attSnap.exists() || !sessSnap.exists()) {
    tbody.innerHTML =
      '<tr><td colspan="4" style="text-align:center;padding:24px;opacity:.6">No history yet</td></tr>';
    return;
  }

  const sessions = sessSnap.val();
  const subjects = subjSnap.exists() ? subjSnap.val() : {};
  const rows = [];

  Object.entries(attSnap.val()).forEach(([sessId, records]) => {
    if (!records[state.currentUser.uid]) return;
    const r = records[state.currentUser.uid];
    const sess = sessions[sessId];
    if (!sess) return;
    rows.push({
      ...r,
      sessId,
      subjectId: sess.subjectId,
      sessionDate: sess.createdAt,
    });
  });

  rows.sort((a, b) => (b.sessionDate || 0) - (a.sessionDate || 0));

  /* Store for filter use */
  window._studentHistoryRows = rows;
  window._subjects = subjects;
  renderHistoryTable(rows, subjects);
}

function renderHistoryTable(rows, subjects) {
  const tbody = $("#history-tbody");
  const subjectFilter = $("#history-subject-filter").value;
  const statusFilter = $("#history-status-filter").value;
  tbody.innerHTML = "";

  const filtered = rows.filter((r) => {
    if (subjectFilter && r.subjectId !== subjectFilter) return false;
    if (statusFilter && r.status !== statusFilter) return false;
    return true;
  });

  if (!filtered.length) {
    tbody.innerHTML =
      '<tr><td colspan="4" style="text-align:center;padding:24px;opacity:.6">No records found</td></tr>';
    return;
  }

  filtered.forEach((r) => {
    const subj = subjects[r.subjectId] || { name: r.subjectId };
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${formatDate(r.sessionDate)}</td><td>${escHtml(subj.name)}</td><td>${statusBadge(r.status)}</td><td>${formatTime(r.timestamp)}</td>`;
    tbody.appendChild(tr);
  });
}

/* ===========================================================
   QR SCANNER
   =========================================================== */
export function initScanSection() {
  const resultEl = $("#scan-result");
  hide(resultEl);
  startScanner();
}

function startScanner() {
  const readerEl = $("#qr-reader");
  const resultEl = $("#scan-result");
  hide(resultEl);
  readerEl.innerHTML = "";

  if (state.html5QrScanner) {
    try {
      state.html5QrScanner.stop();
    } catch (e) {
      /* ignore */
    }
  }

  state.html5QrScanner = new Html5Qrcode("qr-reader");
  state.html5QrScanner
    .start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 250, height: 250 } },
      async (decodedText) => {
        try {
          state.html5QrScanner.stop();
        } catch (e) {
          /* ignore */
        }
        await processQrScan(decodedText);
      },
      () => {},
    )
    .catch((err) => {
      toast("Camera access denied or unavailable", "error");
      console.error(err);
    });
}

async function processQrScan(data) {
  const resultEl = $("#scan-result");
  const msgEl = $("#scan-message");
  resultEl.className = "scan-result";
  show(resultEl);

  try {
    const approvalStatus = state.currentUserData?.approvalStatus || "approved";
    if (approvalStatus !== "approved") {
      throw new Error(
        "Your account is not approved yet. Ask your teacher to approve your signup first.",
      );
    }

    let qr;
    try {
      qr = JSON.parse(data);
    } catch (e) {
      throw new Error("Invalid QR code format");
    }
    const { sessionId, token } = qr;
    if (!sessionId || !token) throw new Error("Invalid QR code data");

    /* 1. Session exists? */
    const sessSnap = await get(ref(db, `sessions/${sessionId}`));
    if (!sessSnap.exists())
      throw new Error("Session not found. This QR code is invalid.");
    const session = sessSnap.val();

    /* 2. Session active? */
    if (session.status !== "active")
      throw new Error("This session has already ended.");

    /* 3. Token matches (dynamic QR)? */
    if (session.currentQrToken !== token)
      throw new Error(
        "This QR code has expired. Please scan the latest code displayed by your instructor.",
      );

    /* 4. QR freshness (60s window) */
    if (Date.now() - session.qrGeneratedAt > 60000)
      throw new Error("QR code expired. Ask your instructor to refresh.");

    /* 5. Session window open? */
    if (Date.now() > session.expiresAt)
      throw new Error("This session has expired.");

    /* 6. User data? */
    if (!state.currentUserData)
      throw new Error("User data not found. Please log in again.");

    /* 7. Enrollment check */
    const enrollCheck = await get(
      ref(db, `enrollments/${session.subjectId}/${state.currentUser.uid}`),
    );
    if (!enrollCheck.exists()) {
      const subjSnap = await get(ref(db, `subjects/${session.subjectId}`));
      const subjName = subjSnap.exists() ? subjSnap.val().name : "this class";
      throw new Error(
        `You are not enrolled in "${subjName}". Ask your instructor to add you first.`,
      );
    }

    /* 8. Already scanned? */
    const dupe = await get(
      ref(db, `attendance/${sessionId}/${state.currentUser.uid}`),
    );
    if (dupe.exists())
      throw new Error(
        "Your attendance has already been recorded for this session.",
      );

    /* 9. Present or Late? */
    const subjSnap2 = await get(ref(db, `subjects/${session.subjectId}`));
    const lateThreshold = subjSnap2.exists()
      ? subjSnap2.val().lateThreshold || 15
      : 15;
    const minutesSinceStart = (Date.now() - session.createdAt) / 60000;
    const status = minutesSinceStart > lateThreshold ? "late" : "present";

    /* 10. Record attendance */
    await set(ref(db, `attendance/${sessionId}/${state.currentUser.uid}`), {
      studentId: state.currentUserData.studentId || "",
      studentName: state.currentUserData.name || "",
      status,
      timestamp: Date.now(),
      scannedQrToken: token,
    });
    await push(ref(db, "auditLog"), {
      action: "attendance_recorded",
      sessionId,
      userId: state.currentUser.uid,
      status,
      ts: Date.now(),
    });

    const subjName = subjSnap2.exists() ? subjSnap2.val().name : "Session";
    resultEl.classList.add("success");
    resultEl.querySelector("i").className = "fas fa-check-circle";
    msgEl.innerHTML = `<strong>Attendance Recorded!</strong><br>${escHtml(subjName)} — ${status === "present" ? "On Time" : "Late"}<br><small>${formatTime(Date.now())}</small>`;
    toast(`Marked as ${status}!`, "success");

    loadStudentStats();
    loadStudentHistory();
    loadStudentSubjects();
  } catch (err) {
    resultEl.classList.add("error");
    resultEl.querySelector("i").className = "fas fa-times-circle";
    msgEl.innerHTML = `<strong>Scan Failed</strong><br>${escHtml(err.message)}`;
    toast(err.message, "error");
  }
}

/* ===========================================================
   SETUP STUDENT LISTENERS
   =========================================================== */
export function setupStudentListeners() {
  /* ---- History filters ---- */
  $("#history-subject-filter").addEventListener("change", () => {
    if (window._studentHistoryRows)
      renderHistoryTable(window._studentHistoryRows, window._subjects || {});
  });
  $("#history-status-filter").addEventListener("change", () => {
    if (window._studentHistoryRows)
      renderHistoryTable(window._studentHistoryRows, window._subjects || {});
  });

  /* ---- Rescan button ---- */
  window.appRescan = () => {
    hide("#scan-result");
    startScanner();
  };
}
