/* =========================================================
   AttendIT — Sessions, Monitor & QR Code
   ========================================================= */

import { db, ref, set, get, push, update, onValue } from "./firebase-init.js";
import {
  $,
  toast,
  show,
  hide,
  formatDate,
  formatTime,
  openModal,
  closeModal,
  statusBadge,
  escHtml,
  generateQrToken,
  renderQrCodeFallback,
} from "./helpers.js";
import state from "./state.js";
import { loadStats } from "./stats.js";

export function stopMonitorAttendance() {
  if (state.monitorUnsub) {
    try {
      state.monitorUnsub();
    } catch (err) {
      /* ignore */
    }
    state.monitorUnsub = null;
  }

  const tbody = $("#monitor-tbody");
  if (tbody) tbody.innerHTML = "";
  const countBadge = $("#monitor-count");
  if (countBadge) countBadge.textContent = "0 present";
}

/* ===========================================================
   LOAD SESSIONS
   =========================================================== */
export async function loadSessions() {
  const snap = await get(ref(db, "sessions"));
  const container = $("#sessions-list");
  container.innerHTML = "";

  if (!snap.exists()) {
    container.innerHTML =
      '<div class="empty-state"><i class="fas fa-calendar-alt"></i><p>No sessions yet</p></div>';
    return;
  }

  const sessions = snap.val();
  const subjSnap = await get(ref(db, "subjects"));
  const subjects = subjSnap.exists() ? subjSnap.val() : {};

  const table = document.createElement("table");
  table.className = "data-table";
  table.innerHTML =
    "<thead><tr><th>Subject</th><th>Date</th><th>Start</th><th>Duration</th><th>Status</th><th>Actions</th></tr></thead>";
  const tbody = document.createElement("tbody");
  let hasRows = false;

  Object.keys(sessions)
    .sort((a, b) => (sessions[b].createdAt || 0) - (sessions[a].createdAt || 0))
    .forEach((id) => {
      const s = sessions[id];
      if (s.instructorId !== state.currentUser.uid) return;
      hasRows = true;
      const subjName = subjects[s.subjectId]?.name || s.subjectId;
      const isActive = s.status === "active";
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><strong>${escHtml(subjName)}</strong></td>
        <td>${formatDate(s.createdAt)}</td>
        <td>${formatTime(s.createdAt)}</td>
        <td>${s.duration} min</td>
        <td>${isActive ? '<span class="badge badge-present">Active</span>' : '<span class="badge badge-absent">Closed</span>'}</td>
        <td>${isActive ? `<button class="btn btn-sm btn-danger" onclick="window.appEndSession('${id}')"><i class="fas fa-stop"></i> End</button>` : ""}</td>`;
      tbody.appendChild(tr);
    });

  table.appendChild(tbody);
  container.appendChild(
    hasRows
      ? table
      : Object.assign(document.createElement("div"), {
          className: "empty-state",
          innerHTML:
            '<i class="fas fa-calendar-alt"></i><p>No sessions found</p>',
        }),
  );

  refreshMonitorSelect();
}

/* ===========================================================
   MONITOR — Session Select & Auto-Load
   =========================================================== */
export async function refreshMonitorSelect() {
  const monitorSelect = $("#monitor-session-select");
  if (!monitorSelect) return;

  const isMonitorOpen = $("#inst-monitor")?.classList.contains("active");
  const previousSelection = monitorSelect.value;
  monitorSelect.innerHTML =
    '<option value="">Select an active session</option>';

  const snap = await get(ref(db, "sessions"));
  if (!snap.exists()) {
    if (isMonitorOpen) {
      hide("#qr-display-area");
      stopMonitorAttendance();
      if (state.qrInterval) {
        clearInterval(state.qrInterval);
        state.qrInterval = null;
      }
    }
    return;
  }

  const subjSnap = await get(ref(db, "subjects"));
  const subjects = subjSnap.exists() ? subjSnap.val() : {};
  const activeSessions = [];

  Object.entries(snap.val()).forEach(([id, s]) => {
    if (s.instructorId !== state.currentUser.uid || s.status !== "active")
      return;
    activeSessions.push({ id, session: s });
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = `${subjects[s.subjectId]?.name || s.subjectId} — ${formatDate(s.createdAt)} ${formatTime(s.createdAt)}`;
    monitorSelect.appendChild(opt);
  });

  const hasPreviousSelection = activeSessions.some(
    (item) => item.id === previousSelection,
  );

  if (!isMonitorOpen) return;

  if (hasPreviousSelection) {
    monitorSelect.value = previousSelection;
    show("#qr-display-area");
    startQrRotation(previousSelection);
    monitorAttendance(previousSelection);
    return;
  }

  /* Auto-select if exactly one active session */
  if (activeSessions.length === 1) {
    monitorSelect.value = activeSessions[0].id;
    show("#qr-display-area");
    startQrRotation(activeSessions[0].id);
    monitorAttendance(activeSessions[0].id);
    return;
  }

  monitorSelect.value = "";
  hide("#qr-display-area");
  stopMonitorAttendance();

  if (state.qrInterval) {
    clearInterval(state.qrInterval);
    state.qrInterval = null;
  }
}

/* ===========================================================
   QR CODE ROTATION
   =========================================================== */
export async function startQrRotation(sessionId) {
  if (state.qrInterval) clearInterval(state.qrInterval);
  let countdown = 30;
  $("#qr-countdown").textContent = countdown;

  async function refreshQr() {
    const token = generateQrToken();
    const now = Date.now();
    await update(ref(db, `sessions/${sessionId}`), {
      currentQrToken: token,
      qrGeneratedAt: now,
    });
    const qrData = JSON.stringify({ sessionId, token, ts: now });
    const container = $("#qr-code-container");
    container.innerHTML = "";

    /* Generate QR via API with cascading fallbacks */
    const encodedData = encodeURIComponent(qrData);
    const qrApis = [
      `https://quickchart.io/qr?text=${encodedData}&size=280&margin=2`,
      `https://api.qrserver.com/v1/create-qr-code/?size=280x280&margin=10&data=${encodedData}`,
      `https://chart.googleapis.com/chart?cht=qr&chs=280x280&chl=${encodedData}`,
    ];

    const img = document.createElement("img");
    img.alt = "Attendance QR Code";
    img.style.cssText =
      "width:280px;height:280px;border-radius:12px;display:block;";

    let currentApiIndex = 0;
    img.onerror = () => {
      currentApiIndex++;
      if (currentApiIndex < qrApis.length) {
        console.log(`QR API ${currentApiIndex} failed, trying next...`);
        img.src = qrApis[currentApiIndex];
      } else {
        console.error("All QR APIs failed");
        renderQrCodeFallback(container, sessionId, token);
      }
    };
    img.onload = () => {
      console.log(
        `QR code loaded successfully from API ${currentApiIndex + 1}`,
      );
    };
    img.src = qrApis[currentApiIndex];
    container.appendChild(img);
    countdown = 30;
  }

  await refreshQr();
  state.qrInterval = setInterval(async () => {
    countdown--;
    $("#qr-countdown").textContent = Math.max(countdown, 0);
    if (countdown <= 0) await refreshQr();
  }, 1000);

  /* Session info header */
  const sessSnap = await get(ref(db, `sessions/${sessionId}`));
  if (sessSnap.exists()) {
    const s = sessSnap.val();
    const subjSnap = await get(ref(db, `subjects/${s.subjectId}`));
    const subjName = subjSnap.exists() ? subjSnap.val().name : s.subjectId;
    $("#qr-session-title").textContent = subjName;
    $("#qr-session-info").textContent =
      `Started ${formatTime(s.createdAt)} · Duration: ${s.duration} min · Display this QR for students to scan`;
  }
}

/* ===========================================================
   LIVE ATTENDANCE MONITOR
   =========================================================== */
export function monitorAttendance(sessionId) {
  stopMonitorAttendance();

  const unsub = onValue(ref(db, `attendance/${sessionId}`), async (snap) => {
    const tbody = $("#monitor-tbody");
    tbody.innerHTML = "";
    if (!snap.exists()) {
      $("#monitor-count").textContent = "0 present";
      return;
    }
    const records = snap.val();
    let presentCount = 0;
    for (const uid of Object.keys(records)) {
      const r = records[uid];
      if (r.status === "present" || r.status === "late") presentCount++;
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escHtml(r.studentId || "-")}</td>
        <td>${escHtml(r.studentName || "-")}</td>
        <td>${statusBadge(r.status)}</td>
        <td>${formatTime(r.timestamp)}</td>
        <td class="action-btns">
          <button class="btn btn-sm btn-secondary" title="Present" onclick="window.appOverrideStatus('${sessionId}','${uid}','present')"><i class="fas fa-check"></i></button>
          <button class="btn btn-sm btn-secondary" title="Late" onclick="window.appOverrideStatus('${sessionId}','${uid}','late')"><i class="fas fa-clock"></i></button>
          <button class="btn btn-sm btn-danger"    title="Absent" onclick="window.appOverrideStatus('${sessionId}','${uid}','absent')"><i class="fas fa-times"></i></button>
        </td>`;
      tbody.appendChild(tr);
    }
    $("#monitor-count").textContent = `${presentCount} present`;
  });
  state.monitorUnsub = unsub;
}

/* ===========================================================
   SETUP SESSION LISTENERS
   =========================================================== */
export function setupSessionListeners() {
  /* ---- Create session ---- */
  $("#btn-create-session").addEventListener("click", async () => {
    const subjSnap = await get(ref(db, "subjects"));
    let opts = "";
    if (subjSnap.exists()) {
      Object.entries(subjSnap.val()).forEach(([id, s]) => {
        if (s.instructorId === state.currentUser.uid)
          opts += `<option value="${id}">${escHtml(s.name)}</option>`;
      });
    }
    if (!opts) return toast("Create a subject first", "error");

    openModal(
      "New Attendance Session",
      `
      <div class="form-group"><label>Subject</label><select id="m-sess-subj">${opts}</select></div>
      <div class="form-group"><label>Duration (minutes)</label><input type="number" id="m-sess-dur" value="60" min="5" /></div>
      <button class="btn btn-primary btn-full mt-8" id="m-sess-save"><i class="fas fa-play"></i> Start Session</button>
    `,
    );
    $("#m-sess-save").addEventListener("click", async () => {
      const subjectId = $("#m-sess-subj").value;
      const duration = parseInt($("#m-sess-dur").value) || 60;
      const now = Date.now();
      const newRef = push(ref(db, "sessions"));
      await set(newRef, {
        subjectId,
        instructorId: state.currentUser.uid,
        status: "active",
        duration,
        createdAt: now,
        expiresAt: now + duration * 60000,
        currentQrToken: generateQrToken(),
        qrGeneratedAt: now,
      });
      await push(ref(db, "auditLog"), {
        action: "session_created",
        sessionId: newRef.key,
        userId: state.currentUser.uid,
        ts: now,
      });
      toast("Session started! Go to Monitor to display the QR.", "success");
      closeModal();
      loadSessions();
      loadStats();
    });
  });

  /* ---- End session ---- */
  window.appEndSession = async (id) => {
    if (!confirm("End this session?")) return;
    await update(ref(db, `sessions/${id}`), { status: "closed" });

    if ($("#monitor-session-select")?.value === id) {
      $("#monitor-session-select").value = "";
      hide("#qr-display-area");
      stopMonitorAttendance();
    }

    if (state.qrInterval) {
      clearInterval(state.qrInterval);
      state.qrInterval = null;
    }
    toast("Session ended", "success");
    loadSessions();
    loadStats();
  };

  /* ---- Monitor session select ---- */
  $("#monitor-session-select").addEventListener("change", (e) => {
    const sessionId = e.target.value;
    if (!sessionId) {
      hide("#qr-display-area");
      stopMonitorAttendance();
      return;
    }
    show("#qr-display-area");
    startQrRotation(sessionId);
    monitorAttendance(sessionId);
  });

  /* ---- Override attendance status ---- */
  window.appOverrideStatus = async (sessionId, uid, newStatus) => {
    await update(ref(db, `attendance/${sessionId}/${uid}`), {
      status: newStatus,
      overriddenBy: state.currentUser.uid,
      overriddenAt: Date.now(),
    });
    await push(ref(db, "auditLog"), {
      action: "status_override",
      sessionId,
      targetUid: uid,
      newStatus,
      userId: state.currentUser.uid,
      ts: Date.now(),
    });
    toast(`Status → ${newStatus}`, "success");
  };
}
