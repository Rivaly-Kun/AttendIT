/* =========================================================
   AttendIT — Instructor Dashboard Stats
   ========================================================= */

import { db, ref, get } from "./firebase-init.js";
import { $, formatDate, formatTime, escHtml } from "./helpers.js";
import state from "./state.js";

/**
 * Loads and renders instructor dashboard statistics:
 * subject count, sessions today, enrolled students, at-risk, recent activity.
 */
export async function loadStats() {
  const subjSnap = await get(ref(db, "subjects"));
  let subjCount = 0;
  if (subjSnap.exists())
    Object.values(subjSnap.val()).forEach((s) => {
      if (s.instructorId === state.currentUser.uid) subjCount++;
    });
  $("#stat-subjects").textContent = subjCount;

  /* Sessions today */
  const sessSnap = await get(ref(db, "sessions"));
  let todayCount = 0;
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  if (sessSnap.exists())
    Object.values(sessSnap.val()).forEach((s) => {
      if (
        s.instructorId === state.currentUser.uid &&
        s.createdAt >= todayStart.getTime()
      )
        todayCount++;
    });
  $("#stat-sessions").textContent = todayCount;

  /* Unique enrolled students */
  const enrolledSet = new Set();
  if (subjSnap.exists()) {
    for (const id of Object.keys(subjSnap.val())) {
      if (subjSnap.val()[id].instructorId !== state.currentUser.uid) continue;
      const eSnap = await get(ref(db, `enrollments/${id}`));
      if (eSnap.exists())
        Object.keys(eSnap.val()).forEach((uid) => enrolledSet.add(uid));
    }
  }
  $("#stat-students").textContent = enrolledSet.size;

  /* At-risk students (<60 % attendance) */
  const attSnap = await get(ref(db, "attendance"));
  const studentStats = {};
  if (attSnap.exists() && sessSnap.exists()) {
    const sessions = sessSnap.val();
    Object.keys(attSnap.val()).forEach((sessId) => {
      const sess = sessions[sessId];
      if (!sess || sess.instructorId !== state.currentUser.uid) return;
      const records = attSnap.val()[sessId];
      Object.keys(records).forEach((uid) => {
        if (!studentStats[uid]) studentStats[uid] = { total: 0, present: 0 };
        studentStats[uid].total++;
        if (records[uid].status === "present" || records[uid].status === "late")
          studentStats[uid].present++;
      });
    });
  }
  const atRisk = Object.values(studentStats).filter(
    (s) => (s.present / s.total) * 100 < 60,
  ).length;
  $("#stat-at-risk").textContent = atRisk;

  /* Recent activity */
  const actDiv = $("#inst-recent-activity");
  actDiv.innerHTML = "";
  if (sessSnap.exists()) {
    const subjects = subjSnap.exists() ? subjSnap.val() : {};
    const sorted = Object.entries(sessSnap.val())
      .filter(([, s]) => s.instructorId === state.currentUser.uid)
      .sort((a, b) => (b[1].createdAt || 0) - (a[1].createdAt || 0))
      .slice(0, 5);

    if (!sorted.length) {
      actDiv.innerHTML = '<div class="empty-state-sm">No recent activity</div>';
      return;
    }
    sorted.forEach(([, s]) => {
      const div = document.createElement("div");
      div.className = "activity-row";
      div.innerHTML = `
        <div class="activity-icon ${s.status === "active" ? "green" : ""}"><i class="fas fa-calendar-check"></i></div>
        <div class="activity-info">
          <span class="activity-title">${escHtml(subjects[s.subjectId]?.name || s.subjectId)}</span>
          <span class="activity-meta">${formatDate(s.createdAt)} ${formatTime(s.createdAt)} — ${s.status}</span>
        </div>`;
      actDiv.appendChild(div);
    });
  } else {
    actDiv.innerHTML = '<div class="empty-state-sm">No recent activity</div>';
  }
}
