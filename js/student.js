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
export async function initStudentDashboard() {
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

function isCurrentStudentSection(subject) {
  return (
    (subject.grade || "") === (state.currentUserData?.grade || "") &&
    (subject.section || "") === (state.currentUserData?.section || "")
  );
}

function subjectEnrollmentBadge(status) {
  const normalized = (status || "pending").toLowerCase();
  if (normalized === "approved") {
    return '<span class="badge badge-safe">Approved</span>';
  }
  if (normalized === "rejected") {
    return '<span class="badge badge-absent">Rejected</span>';
  }
  if (normalized === "archived") {
    return '<span class="badge">Archived</span>';
  }
  return '<span class="badge badge-late">Pending</span>';
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
      '<div class="empty-state"><i class="fas fa-book-open"></i><p>No subjects found for your grade and section yet.</p></div>';
    return;
  }

  const subjects = subjSnap.val();
  const subjectEnrollmentSnap = await get(ref(db, "subjectEnrollments"));
  const subjectEnrollments = subjectEnrollmentSnap.exists()
    ? subjectEnrollmentSnap.val()
    : {};
  const attSnap = await get(ref(db, "attendance"));
  const sessSnap = await get(ref(db, "sessions"));
  const sessions = sessSnap.exists() ? sessSnap.val() : {};
  let hasAnySubject = false;

  for (const subjId of Object.keys(subjects)) {
    const subj = subjects[subjId];
    const enrollment = subjectEnrollments?.[subjId]?.[state.currentUser.uid];
    const legacyEnrollSnap = await get(
      ref(db, `enrollments/${subjId}/${state.currentUser.uid}`),
    );
    const isRelevant =
      isCurrentStudentSection(subj) || enrollment || legacyEnrollSnap.exists();
    if (!isRelevant) continue;

    hasAnySubject = true;
    const status =
      enrollment?.status || (legacyEnrollSnap.exists() ? "approved" : "");

    let total = 0,
      attended = 0;
    if (status === "approved" && sessSnap.exists() && attSnap.exists()) {
      Object.entries(sessions).forEach(([sessId, sess]) => {
        if (sess.subjectId !== subjId) return;
        total++;
        const att = attSnap.val()?.[sessId]?.[state.currentUser.uid];
        if (att && (att.status === "present" || att.status === "late"))
          attended++;
      });
    }

    const pct = total ? Math.round((attended / total) * 100) : 100;

    const row = document.createElement("div");
    row.className = "subject-summary-row";
    let rightSide = "";
    if (status === "approved") {
      rightSide = `<div class="attendance-bar-wrap">
            <div class="attendance-bar"><div class="attendance-bar-fill" style="width:${pct}%;background:${barColor(pct)}"></div></div>
            <span class="attendance-pct" style="color:${barColor(pct)}">${pct}%</span>
          </div>`;
    } else if (status === "pending") {
      rightSide = `<div class="attendance-status-wrap">${subjectEnrollmentBadge(status)}</div>`;
    } else if (status === "rejected") {
      rightSide = `
        <div class="attendance-status-wrap subject-request-actions">
          ${subjectEnrollmentBadge(status)}
          <button class="btn btn-sm btn-secondary" onclick="window.appRequestSubjectJoin('${subjId}')">
            <i class="fas fa-redo"></i> Request Again
          </button>
        </div>`;
    } else {
      rightSide = `
        <div class="attendance-status-wrap subject-request-actions">
          <button class="btn btn-sm btn-primary" onclick="window.appRequestSubjectJoin('${subjId}')">
            <i class="fas fa-paper-plane"></i> Request Join
          </button>
        </div>`;
    }
    row.innerHTML = `
      <div class="subject-summary-left">
        <span class="subject-name">${escHtml(subj.name)}</span>
        <span class="subject-code">${escHtml(subj.code || "")} | ${escHtml(subj.schedule || subj.scheduleTime || "")}</span>
      </div>
      ${rightSide}`;
    container.appendChild(row);

    if (status === "approved") {
      const opt = document.createElement("option");
      opt.value = subjId;
      opt.textContent = subj.name;
      histFilter.appendChild(opt);
    }
  }

  if (!hasAnySubject)
    container.innerHTML =
      '<div class="empty-state"><i class="fas fa-book-open"></i><p>No subjects match your current grade and section yet.</p></div>';
}

/* ===========================================================
   REQUEST TO JOIN A SUBJECT  ← NEW: was never implemented
   Students click "Request Join" or "Request Again"; this writes
   a pending record into subjectEnrollments so the teacher can
   approve or reject it from their dashboard.
   =========================================================== */
async function requestSubjectJoin(subjId) {
  try {
    // Guard: account must be approved first
    const approvalStatus = state.currentUserData?.approvalStatus || "approved";
    if (approvalStatus !== "approved") {
      toast(
        "Your account must be approved by a teacher before you can request to join a class.",
        "error",
      );
      return;
    }

    // Check current state of this enrollment slot
    const existingSnap = await get(
      ref(db, `subjectEnrollments/${subjId}/${state.currentUser.uid}`),
    );
    if (existingSnap.exists()) {
      const currentStatus = existingSnap.val().status;
      if (currentStatus === "approved") {
        toast("You are already enrolled in this class.", "info");
        return;
      }
      if (currentStatus === "pending") {
        toast(
          "You already have a pending request for this class. Please wait for your teacher to review it.",
          "info",
        );
        return;
      }
      // If rejected or anything else, fall through and re-submit
    }

    // Write the join request
    await set(
      ref(db, `subjectEnrollments/${subjId}/${state.currentUser.uid}`),
      {
        status: "pending",
        requestedAt: Date.now(),
        studentId: state.currentUserData?.studentId || "",
        studentName: state.currentUserData?.name || "",
        grade: state.currentUserData?.grade || "",
        section: state.currentUserData?.section || "",
        userId: state.currentUser.uid,
      },
    );

    // Audit log so the teacher's activity feed picks it up
    await push(ref(db, "auditLog"), {
      action: "subject_join_requested",
      subjectId: subjId,
      userId: state.currentUser.uid,
      studentName: state.currentUserData?.name || "",
      ts: Date.now(),
    });

    toast("Join request sent! Waiting for your teacher to approve.", "success");

    // Refresh the subject list so the button changes to "Pending"
    loadStudentSubjects();
  } catch (err) {
    toast(err.message || "Failed to send join request.", "error");
    console.error(err);
  }
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

  const subjectEnrollmentSnap = await get(ref(db, "subjectEnrollments"));
  const subjectEnrollments = subjectEnrollmentSnap.exists()
    ? subjectEnrollmentSnap.val()
    : {};
  const entries = [];
  for (const [subjId, subj] of Object.entries(subjSnap.val())) {
    const subjectRequest =
      subjectEnrollments?.[subjId]?.[state.currentUser.uid];
    const legacyEnrollSnap = await get(
      ref(db, `enrollments/${subjId}/${state.currentUser.uid}`),
    );
    // Only show in schedule if teacher has approved the request (or legacy enrollment exists)
    const isApproved =
      subjectRequest?.status === "approved" || legacyEnrollSnap.exists();
    if (!isApproved) continue;

    entries.push({
      name: subj.name || "Untitled Subject",
      code: subj.code || "",
      schedule: subj.schedule || subj.scheduleTime || "Schedule not set",
      grade: subj.grade || state.currentUserData?.grade || "",
      section: subj.section || state.currentUserData?.section || "",
    });
  }

  if (!entries.length) {
    container.innerHTML =
      '<div class="empty-state"><i class="fas fa-calendar-times"></i><p>Your schedule will appear after a teacher approves your class requests.</p></div>';
    return;
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));
  entries.forEach((entry) => {
    const row = document.createElement("div");
    row.className = "schedule-row";
    const meta = [
      entry.code,
      entry.grade && entry.section
        ? `${entry.grade} Section ${entry.section}`
        : "",
    ]
      .filter(Boolean)
      .join(" \u2022 ");
    row.innerHTML = `
      <div class="schedule-main">
        <span class="schedule-subject">${escHtml(entry.name)}</span>
        <span class="schedule-meta">${escHtml(meta)}</span>
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

    /* 7. Enrollment check — accepts both the new request-based path
          (subjectEnrollments) and the legacy path (enrollments).
          FIX: original code only checked the legacy path, so students
          who joined via Request Join could never scan in. */
    const [legacyEnrollSnap, newEnrollSnap] = await Promise.all([
      get(ref(db, `enrollments/${session.subjectId}/${state.currentUser.uid}`)),
      get(
        ref(
          db,
          `subjectEnrollments/${session.subjectId}/${state.currentUser.uid}`,
        ),
      ),
    ]);

    const isEnrolled =
      legacyEnrollSnap.exists() ||
      (newEnrollSnap.exists() && newEnrollSnap.val().status === "approved");

    if (!isEnrolled) {
      const subjSnap = await get(ref(db, `subjects/${session.subjectId}`));
      const subjName = subjSnap.exists() ? subjSnap.val().name : "this class";
      // Give a more helpful message if they have a pending request
      if (newEnrollSnap.exists() && newEnrollSnap.val().status === "pending") {
        throw new Error(
          `Your request to join "${subjName}" is still pending. Wait for your teacher to approve it.`,
        );
      }
      throw new Error(
        `You are not enrolled in "${subjName}". Request to join the class first and wait for teacher approval.`,
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

  /* ---- Request Join button (called from inline onclick in subject list) ---- */
  window.appRequestSubjectJoin = (subjId) => requestSubjectJoin(subjId);
}
