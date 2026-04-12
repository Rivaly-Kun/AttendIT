/* =========================================================
   AttendIT — Student Signup Approvals
   ========================================================= */

import { db, ref, get, update, set, push } from "./firebase-init.js";
import { $, toast, escHtml } from "./helpers.js";
import state from "./state.js";
import { loadStats } from "./stats.js";
import { loadSubjects } from "./subjects.js";
import {
  fetchAcademicStructure,
  validateStudentAcademicData,
} from "./academic.js";

function buildSectionKey(grade, section) {
  return `${(grade || "").trim()}::${(section || "").trim()}`;
}

async function getInstructorSectionKeys() {
  const subjSnap = await get(ref(db, "subjects"));
  if (!subjSnap.exists()) return new Set();

  const sectionKeys = new Set();
  Object.values(subjSnap.val()).forEach((subject) => {
    if (subject.instructorId !== state.currentUser.uid) return;
    const key = buildSectionKey(subject.grade, subject.section);
    if (key !== "::") sectionKeys.add(key);
  });

  return sectionKeys;
}

function getApprovalStatusLabel(status) {
  if (status === "approved") {
    return '<span class="badge badge-safe">Approved</span>';
  }
  if (status === "rejected") {
    return '<span class="badge badge-absent">Rejected</span>';
  }
  return '<span class="badge badge-late">Pending</span>';
}

async function getPendingStudents(instructorSectionKeys) {
  const usersSnap = await get(ref(db, "users"));
  if (!usersSnap.exists()) return [];

  return Object.entries(usersSnap.val())
    .filter(([, user]) => {
      if (user.role !== "student") return false;
      const status = user.approvalStatus || "approved";
      if (status !== "pending") return false;
      return instructorSectionKeys.has(
        buildSectionKey(user.grade, user.section),
      );
    })
    .map(([uid, user]) => ({ uid, ...user }))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

async function getMatchingInstructorSubjects(grade, section) {
  const subjSnap = await get(ref(db, "subjects"));
  if (!subjSnap.exists()) return [];

  const matches = [];
  Object.entries(subjSnap.val()).forEach(([subjectId, subject]) => {
    if (subject.instructorId !== state.currentUser.uid) return;
    if ((subject.grade || "") !== grade) return;
    if ((subject.section || "") !== section) return;
    matches.push({ subjectId, ...subject });
  });

  return matches;
}

export async function loadPendingApprovals() {
  const tbody = $("#approval-tbody");
  if (!tbody || state.currentRole !== "instructor") return;

  const instructorSectionKeys = await getInstructorSectionKeys();

  if (!instructorSectionKeys.size) {
    tbody.innerHTML =
      '<tr><td colspan="7" style="text-align:center;padding:24px;opacity:.6">No section-assigned subjects yet. Add grade/section to your subjects to review pending signups.</td></tr>';
    return;
  }

  const pendingStudents = await getPendingStudents(instructorSectionKeys);
  tbody.innerHTML = "";

  if (!pendingStudents.length) {
    tbody.innerHTML =
      '<tr><td colspan="7" style="text-align:center;padding:24px;opacity:.6">No pending signups in your sections</td></tr>';
    return;
  }

  pendingStudents.forEach((student) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escHtml(student.name || "-")}</td>
      <td>${escHtml(student.studentId || "-")}</td>
      <td>${escHtml(student.email || "-")}</td>
      <td>${escHtml(student.grade || "-")}</td>
      <td>${escHtml(student.section || "-")}</td>
      <td>${getApprovalStatusLabel(student.approvalStatus || "pending")}</td>
      <td class="action-btns">
        <button class="btn btn-sm btn-primary" onclick="window.appApproveSignup('${student.uid}')">
          <i class="fas fa-check"></i> Approve
        </button>
        <button class="btn btn-sm btn-danger" onclick="window.appRejectSignup('${student.uid}')">
          <i class="fas fa-times"></i> Reject
        </button>
      </td>`;
    tbody.appendChild(tr);
  });
}

export function setupApprovalListeners() {
  window.appApproveSignup = async (uid) => {
    const instructorSectionKeys = await getInstructorSectionKeys();

    const userSnap = await get(ref(db, `users/${uid}`));
    if (!userSnap.exists()) {
      toast("Student account no longer exists.", "error");
      loadPendingApprovals();
      return;
    }

    const student = userSnap.val();

    if ((student.approvalStatus || "approved") !== "pending") {
      toast("This signup request is no longer pending.", "info");
      loadPendingApprovals();
      return;
    }

    if (
      !instructorSectionKeys.has(
        buildSectionKey(student.grade, student.section),
      )
    ) {
      toast(
        "You can only approve students who belong to your section subjects.",
        "error",
      );
      return;
    }

    const structure = await fetchAcademicStructure();
    const validation = validateStudentAcademicData(structure, student);

    if (!validation.valid) {
      toast(`Cannot approve student: ${validation.reason}`, "error");
      return;
    }

    const matchingSubjects = await getMatchingInstructorSubjects(
      student.grade,
      student.section,
    );

    if (!matchingSubjects.length) {
      toast(
        `No subject found for ${student.grade} Section ${student.section}. Create or update a subject for that section first.`,
        "error",
      );
      return;
    }

    await update(ref(db, `users/${uid}`), {
      approvalStatus: "approved",
      approvedBy: state.currentUser.uid,
      approvedAt: Date.now(),
    });

    let newEnrollments = 0;
    for (const subject of matchingSubjects) {
      const enrollRef = ref(db, `enrollments/${subject.subjectId}/${uid}`);
      const existing = await get(enrollRef);
      if (existing.exists()) continue;

      await set(enrollRef, {
        name: student.name || "",
        studentId: student.studentId || "",
        email: student.email || "",
        grade: student.grade || "",
        section: student.section || "",
        enrolledAt: Date.now(),
        enrolledByApproval: true,
      });
      newEnrollments++;
    }

    await push(ref(db, "auditLog"), {
      action: "signup_approved",
      targetUid: uid,
      approvedBy: state.currentUser.uid,
      grade: student.grade || "",
      section: student.section || "",
      autoEnrollCount: newEnrollments,
      ts: Date.now(),
    });

    toast(
      `${student.name || "Student"} approved and enrolled in ${newEnrollments} section class${newEnrollments === 1 ? "" : "es"}.`,
      "success",
    );
    loadPendingApprovals();
    loadSubjects();
    loadStats();
  };

  window.appRejectSignup = async (uid) => {
    if (!confirm("Reject this student signup request?")) return;

    const instructorSectionKeys = await getInstructorSectionKeys();

    const userSnap = await get(ref(db, `users/${uid}`));
    if (!userSnap.exists()) {
      toast("Student account no longer exists.", "error");
      loadPendingApprovals();
      return;
    }

    const student = userSnap.val();

    if ((student.approvalStatus || "approved") !== "pending") {
      toast("This signup request is no longer pending.", "info");
      loadPendingApprovals();
      return;
    }

    if (
      !instructorSectionKeys.has(
        buildSectionKey(student.grade, student.section),
      )
    ) {
      toast(
        "You can only reject students who belong to your section subjects.",
        "error",
      );
      return;
    }

    await update(ref(db, `users/${uid}`), {
      approvalStatus: "rejected",
      rejectedBy: state.currentUser.uid,
      rejectedAt: Date.now(),
    });

    await push(ref(db, "auditLog"), {
      action: "signup_rejected",
      targetUid: uid,
      rejectedBy: state.currentUser.uid,
      ts: Date.now(),
    });

    toast("Signup request rejected.", "info");
    loadPendingApprovals();
  };
}
