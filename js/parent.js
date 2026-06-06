/* =========================================================
   AttendIT — Parent Portal & Invite Code System
   ========================================================= */

import { db, ref, set, get, push } from "./firebase-init.js";
import {
  $,
  toast,
  escHtml,
  formatDate,
  formatTime,
  statusBadge,
  barColor,
} from "./helpers.js";
import state from "./state.js";

/* ===========================================================
   STUDENT SIDE — Invite Code Generation
   =========================================================== */

/**
 * Generate a short random invite code, save it to:
 *   users/{uid}/inviteCode  — so we can display it later
 *   inviteCodes/{code}      — lookup table for parents
 */
async function generateInviteCode() {
  if (!state.currentUser || !state.currentUserData) {
    toast("You must be logged in.", "error");
    return;
  }

  // If student already has an invite code, just show it
  const existing = state.currentUserData.inviteCode;
  if (existing) {
    $("#stu-invite-code").textContent = existing;
    toast("Your invite code is shown above.", "info");
    return;
  }

  try {
    // Generate a short 6-char uppercase code
    const code = generateShortCode();

    // Save to lookup table: inviteCodes/{code} → { uid, studentId, name }
    await set(ref(db, `inviteCodes/${code}`), {
      uid: state.currentUser.uid,
      studentId: state.currentUserData.studentId || "",
      name: state.currentUserData.name || "",
      createdAt: Date.now(),
    });

    // Save to user record
    await set(
      ref(db, `users/${state.currentUser.uid}/inviteCode`),
      code,
    );

    // Update local state
    state.currentUserData.inviteCode = code;

    // Display it
    $("#stu-invite-code").textContent = code;
    toast("Invite code generated!", "success");
  } catch (err) {
    console.error("Failed to generate invite code:", err);
    toast("Failed to generate invite code.", "error");
  }
}

function generateShortCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I, O, 0, 1
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

/**
 * Called on student dashboard load — show existing invite code if any.
 */
export function loadStudentInviteCode() {
  const el = $("#stu-invite-code");
  if (!el) return;
  const code = state.currentUserData?.inviteCode;
  el.textContent = code || "Not generated";
}

/* ===========================================================
   PARENT SIDE — Link Child
   =========================================================== */

/**
 * Link a child by invite code or school ID.
 * Steps:
 *   1. Try invite code lookup: inviteCodes/{input}
 *   2. If not found, try school ID lookup: scan users for matching studentId
 *   3. Save to parentLinks/{parentUid}/{childUid}
 */
async function linkChild() {
  const input = $("#parent-link-code").value.trim().toUpperCase();
  if (!input) {
    toast("Enter an invite code or school ID.", "error");
    return;
  }

  if (!state.currentUser) {
    toast("You must be logged in.", "error");
    return;
  }

  try {
    let childUid = null;
    let childData = null;

    // 1. Try invite code lookup
    const inviteSnap = await get(ref(db, `inviteCodes/${input}`));
    if (inviteSnap.exists()) {
      childUid = inviteSnap.val().uid;
      const userSnap = await get(ref(db, `users/${childUid}`));
      if (userSnap.exists()) {
        childData = userSnap.val();
      }
    }

    // 2. If not found by invite code, try school ID
    if (!childUid) {
      const usersSnap = await get(ref(db, "users"));
      if (usersSnap.exists()) {
        const users = usersSnap.val();
        for (const [uid, userData] of Object.entries(users)) {
          if (
            userData.role === "student" &&
            userData.studentId &&
            userData.studentId.toUpperCase() === input
          ) {
            childUid = uid;
            childData = userData;
            break;
          }
        }
      }
    }

    if (!childUid || !childData) {
      toast(
        "No student found with this invite code or school ID.",
        "error",
      );
      return;
    }

    // 3. Check if already linked
    const existingSnap = await get(
      ref(db, `parentLinks/${state.currentUser.uid}/${childUid}`),
    );
    if (existingSnap.exists()) {
      toast("This child is already linked to your account.", "info");
      return;
    }

    // 4. Save the parent-child link
    await set(
      ref(db, `parentLinks/${state.currentUser.uid}/${childUid}`),
      {
        childName: childData.name || "",
        childStudentId: childData.studentId || "",
        childGrade: childData.grade || "",
        childSection: childData.section || "",
        linkedAt: Date.now(),
      },
    );

    // Audit log
    await push(ref(db, "auditLog"), {
      action: "parent_linked_child",
      parentId: state.currentUser.uid,
      childId: childUid,
      ts: Date.now(),
    });

    toast(`Linked to ${childData.name || "student"} successfully!`, "success");
    $("#parent-link-code").value = "";

    // Refresh child list
    loadParentDashboard();
  } catch (err) {
    console.error("Failed to link child:", err);
    toast("Failed to link child. Please try again.", "error");
  }
}

/* ===========================================================
   PARENT SIDE — Dashboard
   =========================================================== */

let _selectedChildUid = null;

export async function loadParentDashboard() {
  if (!state.currentUser) return;

  const listEl = $("#parent-child-list");
  if (!listEl) return;

  // Load linked children
  const linksSnap = await get(
    ref(db, `parentLinks/${state.currentUser.uid}`),
  );

  if (!linksSnap.exists()) {
    listEl.innerHTML =
      '<p class="empty-state-sm">No linked children yet</p>';
    resetParentOverview();
    return;
  }

  const links = linksSnap.val();
  const childEntries = Object.entries(links);
  listEl.innerHTML = "";

  childEntries.forEach(([childUid, data]) => {
    const item = document.createElement("div");
    item.className = `parent-child-item${_selectedChildUid === childUid ? " active" : ""}`;
    item.innerHTML = `
      <div class="parent-child-info">
        <div class="parent-child-avatar">
          <i class="fas fa-user-graduate"></i>
        </div>
        <div>
          <strong>${escHtml(data.childName || "Student")}</strong>
          <span>${escHtml(data.childStudentId || "")}${data.childGrade ? ` • ${escHtml(data.childGrade)}` : ""}${data.childSection ? ` ${escHtml(data.childSection)}` : ""}</span>
        </div>
      </div>`;
    item.addEventListener("click", () => {
      _selectedChildUid = childUid;
      // Re-highlight
      listEl
        .querySelectorAll(".parent-child-item")
        .forEach((el) => el.classList.remove("active"));
      item.classList.add("active");
      loadChildAttendanceOverview(childUid, data);
    });
    listEl.appendChild(item);
  });

  // Auto-select first child if none selected or selected is gone
  if (!_selectedChildUid || !links[_selectedChildUid]) {
    _selectedChildUid = childEntries[0][0];
    listEl.querySelector(".parent-child-item")?.classList.add("active");
  }

  // Load overview for selected child
  if (_selectedChildUid && links[_selectedChildUid]) {
    loadChildAttendanceOverview(
      _selectedChildUid,
      links[_selectedChildUid],
    );
  }
}

function resetParentOverview() {
  $("#parent-child-title").textContent = "Attendance Overview";
  $("#parent-child-meta").textContent = "No child selected";
  $("#parent-stat-present").textContent = "0";
  $("#parent-stat-late").textContent = "0";
  $("#parent-stat-absent").textContent = "0";
  $("#parent-stat-rate").textContent = "0%";
  $("#parent-recent-sessions").innerHTML =
    '<p class="empty-state">Select a child to view attendance</p>';
  $("#parent-subject-breakdown").innerHTML =
    '<p class="empty-state">Select a child to view subjects</p>';
}

async function loadChildAttendanceOverview(childUid, childLink) {
  const childName = childLink.childName || "Student";

  $("#parent-child-title").textContent = `${childName}'s Attendance`;
  $("#parent-child-meta").textContent = [
    childLink.childStudentId,
    childLink.childGrade,
    childLink.childSection,
  ]
    .filter(Boolean)
    .join(" • ");

  // Load attendance data
  const [attSnap, sessSnap, subjSnap] = await Promise.all([
    get(ref(db, "attendance")),
    get(ref(db, "sessions")),
    get(ref(db, "subjects")),
  ]);

  const sessions = sessSnap.exists() ? sessSnap.val() : {};
  const subjects = subjSnap.exists() ? subjSnap.val() : {};
  const attendance = attSnap.exists() ? attSnap.val() : {};

  // Calculate stats
  let present = 0,
    late = 0,
    absent = 0;
  const recentRows = [];
  const subjectStats = {}; // { subjId: { name, present, late, absent } }

  for (const [sessId, sessData] of Object.entries(sessions)) {
    const record = attendance[sessId]?.[childUid];
    const subj = subjects[sessData.subjectId] || {
      name: sessData.subjectId,
    };
    const subjId = sessData.subjectId;

    // Initialize subject stats
    if (!subjectStats[subjId]) {
      subjectStats[subjId] = {
        name: subj.name || subjId,
        present: 0,
        late: 0,
        absent: 0,
      };
    }

    if (record) {
      if (record.status === "present") {
        present++;
        subjectStats[subjId].present++;
      } else if (record.status === "late") {
        late++;
        subjectStats[subjId].late++;
      } else {
        absent++;
        subjectStats[subjId].absent++;
      }

      recentRows.push({
        date: sessData.createdAt,
        subject: subj.name || sessData.subjectId,
        status: record.status,
        time: record.timestamp,
      });
    }
  }

  // Update stat cards
  const total = present + late + absent;
  const rate = total ? Math.round(((present + late) / total) * 100) : 0;

  $("#parent-stat-present").textContent = present;
  $("#parent-stat-late").textContent = late;
  $("#parent-stat-absent").textContent = absent;
  $("#parent-stat-rate").textContent = rate + "%";

  // Recent sessions — show last 10
  const recentContainer = $("#parent-recent-sessions");
  recentRows.sort((a, b) => (b.date || 0) - (a.date || 0));
  const recent = recentRows.slice(0, 10);

  if (!recent.length) {
    recentContainer.innerHTML =
      '<p class="empty-state">No attendance records yet</p>';
  } else {
    recentContainer.innerHTML = recent
      .map(
        (r) => `
        <div class="activity-row">
          <div class="activity-icon ${r.status === "present" || r.status === "late" ? "green" : ""}">
            <i class="fas fa-${r.status === "present" ? "check-circle" : r.status === "late" ? "clock" : "times-circle"}"></i>
          </div>
          <div class="activity-info">
            <span class="activity-title">${escHtml(r.subject)}</span>
            <span class="activity-meta">${formatDate(r.date)} • ${formatTime(r.time)}</span>
          </div>
          ${statusBadge(r.status)}
        </div>`,
      )
      .join("");
  }

  // Per-subject breakdown
  const subjectContainer = $("#parent-subject-breakdown");
  const subjectKeys = Object.keys(subjectStats);

  if (!subjectKeys.length) {
    subjectContainer.innerHTML =
      '<p class="empty-state">No subject data available</p>';
  } else {
    subjectContainer.innerHTML = subjectKeys
      .map((sid) => {
        const s = subjectStats[sid];
        const sTotal = s.present + s.late + s.absent;
        const pct = sTotal
          ? Math.round(((s.present + s.late) / sTotal) * 100)
          : 100;
        return `
          <div class="subject-summary-row">
            <div class="subject-summary-left">
              <span class="subject-name">${escHtml(s.name)}</span>
              <span class="subject-code">${s.present}P / ${s.late}L / ${s.absent}A — ${sTotal} total</span>
            </div>
            <div class="attendance-bar-wrap">
              <div class="attendance-bar">
                <div class="attendance-bar-fill" style="width:${pct}%;background:${barColor(pct)}"></div>
              </div>
              <span class="attendance-pct" style="color:${barColor(pct)}">${pct}%</span>
            </div>
          </div>`;
      })
      .join("");
  }
}

/* ===========================================================
   SETUP LISTENERS
   =========================================================== */
export function setupParentListeners() {
  // Student: generate invite code
  const genBtn = $("#btn-generate-invite");
  if (genBtn) {
    genBtn.addEventListener("click", generateInviteCode);
  }

  // Parent: link child
  const linkBtn = $("#btn-parent-link-child");
  if (linkBtn) {
    linkBtn.addEventListener("click", linkChild);
  }

  // Allow pressing Enter in the link code input
  const linkInput = $("#parent-link-code");
  if (linkInput) {
    linkInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        linkChild();
      }
    });
  }
}
