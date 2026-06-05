/* =========================================================
   AttendIT - Account and Subject-Level Approvals
   ========================================================= */

import { db, ref, get, update, set, push } from "./firebase-init.js";
import { $, toast, escHtml, formatDate } from "./helpers.js";
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

function formatSectionLabel(grade, section) {
  const g = (grade || "").trim();
  const s = (section || "").trim();
  if (!g && !s) return "No grade/section";
  if (!s) return g;
  return `${g} - ${s}`;
}

function getStatusBadge(status) {
  if (status === "approved") {
    return '<span class="badge badge-safe">Approved</span>';
  }
  if (status === "rejected") {
    return '<span class="badge badge-absent">Rejected</span>';
  }
  if (status === "archived") {
    return '<span class="badge">Archived</span>';
  }
  return '<span class="badge badge-late">Pending</span>';
}

async function getInstructorSubjects() {
  const subjSnap = await get(ref(db, "subjects"));
  if (!subjSnap.exists() || !state.currentUser) return [];

  return Object.entries(subjSnap.val())
    .filter(([, subject]) => subject.instructorId === state.currentUser.uid)
    .map(([subjectId, subject]) => ({ subjectId, ...subject }))
    .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
}

function getInstructorSectionKeys(subjects) {
  const sectionKeys = new Set();
  subjects.forEach((subject) => {
    const key = buildSectionKey(subject.grade, subject.section);
    if (key !== "::") sectionKeys.add(key);
  });
  return sectionKeys;
}

async function getPendingAccountStudents(sectionKeys) {
  const usersSnap = await get(ref(db, "users"));
  if (!usersSnap.exists()) return [];

  return Object.entries(usersSnap.val())
    .filter(([, user]) => {
      if (user.role !== "student") return false;
      if ((user.approvalStatus || "approved") !== "pending") return false;
      return sectionKeys.has(buildSectionKey(user.grade, user.section));
    })
    .map(([uid, user]) => ({ uid, ...user }))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

async function getAllSubjectsForStudentSection(student) {
  const subjSnap = await get(ref(db, "subjects"));
  if (!subjSnap.exists()) return [];

  return Object.entries(subjSnap.val())
    .filter(([, subject]) => {
      return (
        (subject.grade || "") === (student.grade || "") &&
        (subject.section || "") === (student.section || "")
      );
    })
    .map(([subjectId, subject]) => ({ subjectId, ...subject }));
}

async function createPendingSubjectEnrollmentsForStudent(uid, student) {
  const matchingSubjects = await getAllSubjectsForStudentSection(student);
  const now = Date.now();
  let createdCount = 0;

  for (const subject of matchingSubjects) {
    const enrollmentRef = ref(
      db,
      `subjectEnrollments/${subject.subjectId}/${uid}`,
    );
    const existing = await get(enrollmentRef);
    if (existing.exists()) continue;

    await set(enrollmentRef, {
      status: "pending",
      requestedAt: now,
      reviewedAt: null,
      reviewedBy: null,
      studentGrade: student.grade || "",
      studentSection: student.section || "",
      studentName: student.name || "",
      studentId: student.studentId || student.schoolId || "",
      studentEmail: student.email || "",
    });
    createdCount++;
  }

  return createdCount;
}

function renderAccountApprovals(container, pendingStudents) {
  const section = document.createElement("section");
  section.className = "approval-block";
  
  const pendingCount = pendingStudents.length;
  const badgeClass = pendingCount > 0 ? "badge-late" : "badge-safe";
  
  section.innerHTML = `
    <div class="approval-block-header">
      <div>
        <h3><i class="fas fa-user-shield"></i> Account Gate</h3>
        <p>Students must clear this before subject teachers can review them.</p>
      </div>
      <span class="badge ${badgeClass}">${pendingCount} pending</span>
    </div>
  `;

  const list = document.createElement("div");
  list.className = "approval-list";

  if (!pendingStudents.length) {
    list.innerHTML = `
      <div class="empty-state-sm">
        <div class="empty-state-icon"><i class="fas fa-user-check"></i></div>
        <p>No pending account requests in your sections.</p>
      </div>
    `;
  } else {
    pendingStudents.forEach((student) => {
      const row = document.createElement("div");
      row.className = "approval-row";
      row.innerHTML = `
        <div class="approval-student">
          <div class="student-avatar-badge">
            <i class="fas fa-user-graduate"></i>
          </div>
          <div class="student-details">
            <strong class="student-name">${escHtml(student.name || "-")}</strong>
            <div class="student-info-meta">
              <span class="meta-item"><i class="far fa-id-card"></i> ${escHtml(student.studentId || student.schoolId || "-")}</span>
              <span class="meta-item"><i class="far fa-envelope"></i> ${escHtml(student.email || "-")}</span>
              <span class="meta-item"><i class="fas fa-graduation-cap"></i> ${escHtml(formatSectionLabel(student.grade, student.section))}</span>
            </div>
            <div class="student-info-meta mt-8">
              <span class="meta-item"><i class="far fa-clock"></i> Applied ${formatDate(student.createdAt)}</span>
              <span class="tag-badge ${student.studentType === 'new' ? 'tag-new' : 'tag-existing'}">
                <i class="fas fa-tag"></i> ${escHtml(student.studentType || "existing")}
              </span>
            </div>
          </div>
        </div>
        <div class="action-btns">
          <button class="btn btn-sm btn-approve" onclick="window.appApproveSignup('${student.uid}')">
            <i class="fas fa-check"></i> Approve Account
          </button>
          <button class="btn btn-sm btn-reject" onclick="window.appRejectSignup('${student.uid}')">
            <i class="fas fa-times"></i>
          </button>
        </div>`;
      list.appendChild(row);
    });
  }

  section.appendChild(list);
  container.appendChild(section);
}

function renderSubjectApprovals(container, subjects, enrollmentGroups, users) {
  const section = document.createElement("section");
  section.className = "approval-block mt-24";

  let totalPending = 0;
  const subjectCardData = subjects.map((subject) => {
    const entries = Object.entries(enrollmentGroups[subject.subjectId] || {})
      .filter(([, enrollment]) => (enrollment.status || "pending") === "pending")
      .map(([uid, enrollment]) => ({ uid, ...enrollment }));
    totalPending += entries.length;
    return { subject, entries };
  });

  const badgeClass = totalPending > 0 ? "badge-late" : "badge-safe";

  section.innerHTML = `
    <div class="approval-block-header">
      <div>
        <h3><i class="fas fa-book-reader"></i> Subject Queues</h3>
        <p>Approve or reject students for each subject you own.</p>
      </div>
      <span class="badge ${badgeClass}">${totalPending} pending</span>
    </div>
  `;

  const queues = document.createElement("div");
  queues.className = "subject-approval-grid";

  if (!subjects.length) {
    queues.innerHTML = `
      <div class="empty-state-sm" style="grid-column: 1 / -1; width: 100%;">
        <div class="empty-state-icon" style="background: var(--blue-light); color: var(--blue);"><i class="fas fa-folder-open"></i></div>
        <p>No subjects assigned to your account yet.</p>
      </div>
    `;
    section.appendChild(queues);
    container.appendChild(section);
    return;
  }

  subjectCardData.forEach(({ subject, entries }) => {
    const card = document.createElement("article");
    card.className = "subject-approval-card";
    
    const countBadgeClass = entries.length > 0 ? "badge-late" : "badge-safe";
    
    card.innerHTML = `
      <div class="subject-approval-card-header">
        <div>
          <h4>${escHtml(subject.name || "Untitled Subject")}</h4>
          <p>${escHtml(subject.code || "")}${subject.code ? " | " : ""}${escHtml(formatSectionLabel(subject.grade, subject.section))}</p>
        </div>
        <span class="badge ${countBadgeClass}">${entries.length}</span>
      </div>
    `;

    const list = document.createElement("div");
    list.className = "approval-list compact";

    if (!entries.length) {
      list.innerHTML = `
        <div class="empty-state-sm">
          <div class="empty-state-icon"><i class="fas fa-clipboard-check"></i></div>
          <p>No pending students.</p>
        </div>
      `;
    } else {
      entries
        .sort((a, b) =>
          (a.studentName || "").localeCompare(b.studentName || ""),
        )
        .forEach((entry) => {
          const user = users[entry.uid] || {};
          const row = document.createElement("div");
          row.className = "approval-row";
          row.innerHTML = `
            <div class="approval-student">
              <div class="student-avatar-badge compact">
                <i class="fas fa-user"></i>
              </div>
              <div class="student-details">
                <strong class="student-name">${escHtml(entry.studentName || user.name || "-")}</strong>
                <div class="student-info-meta compact">
                  <span class="meta-item"><i class="far fa-id-card"></i> ${escHtml(entry.studentId || user.studentId || user.schoolId || "-")}</span>
                </div>
                <div class="student-info-meta compact mt-4">
                  <span class="meta-item"><i class="far fa-clock"></i> Requested ${formatDate(entry.requestedAt)}</span>
                </div>
              </div>
            </div>
            <div class="action-btns">
              <button class="btn btn-sm btn-approve" onclick="window.appApproveSubjectEnrollment('${subject.subjectId}','${entry.uid}')">
                <i class="fas fa-check"></i> Approve
              </button>
              <button class="btn btn-sm btn-reject" onclick="window.appRejectSubjectEnrollment('${subject.subjectId}','${entry.uid}')">
                <i class="fas fa-times"></i>
              </button>
            </div>`;
          list.appendChild(row);
        });
    }

    card.appendChild(list);
    queues.appendChild(card);
  });

  section.appendChild(queues);
  container.appendChild(section);
}

export async function loadPendingApprovals() {
  const container = $("#approval-content");
  if (!container || state.currentRole !== "instructor") return;

  container.innerHTML =
    '<p class="empty-state-sm">Loading approval queues...</p>';

  const subjects = await getInstructorSubjects();
  const sectionKeys = getInstructorSectionKeys(subjects);

  if (!sectionKeys.size) {
    container.innerHTML =
      '<p class="empty-state">No section-assigned subjects yet. Add grade and section to your subjects to review approvals.</p>';
    return;
  }

  const [pendingStudents, enrollmentSnap, usersSnap] = await Promise.all([
    getPendingAccountStudents(sectionKeys),
    get(ref(db, "subjectEnrollments")),
    get(ref(db, "users")),
  ]);

  const enrollmentGroups = enrollmentSnap.exists() ? enrollmentSnap.val() : {};
  const users = usersSnap.exists() ? usersSnap.val() : {};

  container.innerHTML = "";
  renderAccountApprovals(container, pendingStudents);
  renderSubjectApprovals(container, subjects, enrollmentGroups, users);
}

export function setupApprovalListeners() {
  window.appApproveSignup = async (uid) => {
    const subjects = await getInstructorSubjects();
    const instructorSectionKeys = getInstructorSectionKeys(subjects);

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

    await update(ref(db, `users/${uid}`), {
      approvalStatus: "approved",
      approvedBy: state.currentUser.uid,
      approvedAt: Date.now(),
      studentType: student.studentType || "existing",
    });

    const subjectRequestCount = await createPendingSubjectEnrollmentsForStudent(
      uid,
      student,
    );

    await push(ref(db, "auditLog"), {
      action: "account_approved",
      targetUid: uid,
      approvedBy: state.currentUser.uid,
      grade: student.grade || "",
      section: student.section || "",
      subjectRequestCount,
      ts: Date.now(),
    });

    toast(
      `${student.name || "Student"} approved. ${subjectRequestCount} subject request${subjectRequestCount === 1 ? "" : "s"} created.`,
      "success",
    );
    loadPendingApprovals();
    loadStats();
  };

  window.appRejectSignup = async (uid) => {
    if (!confirm("Reject this student signup request?")) return;

    const subjects = await getInstructorSubjects();
    const instructorSectionKeys = getInstructorSectionKeys(subjects);

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
      action: "account_rejected",
      targetUid: uid,
      rejectedBy: state.currentUser.uid,
      ts: Date.now(),
    });

    toast("Signup request rejected.", "info");
    loadPendingApprovals();
  };

  window.appApproveSubjectEnrollment = async (subjectId, uid) => {
    const subjectSnap = await get(ref(db, `subjects/${subjectId}`));
    if (!subjectSnap.exists()) {
      toast("Subject no longer exists.", "error");
      loadPendingApprovals();
      return;
    }

    const subject = subjectSnap.val();
    if (subject.instructorId !== state.currentUser.uid) {
      toast("You can only approve students for your own subjects.", "error");
      return;
    }

    const enrollmentRef = ref(db, `subjectEnrollments/${subjectId}/${uid}`);
    const enrollmentSnap = await get(enrollmentRef);
    if (!enrollmentSnap.exists()) {
      toast("Subject request no longer exists.", "info");
      loadPendingApprovals();
      return;
    }

    const enrollment = enrollmentSnap.val();
    if ((enrollment.status || "pending") !== "pending") {
      toast("This subject request is no longer pending.", "info");
      loadPendingApprovals();
      return;
    }

    const userSnap = await get(ref(db, `users/${uid}`));
    const student = userSnap.exists() ? userSnap.val() : {};
    const now = Date.now();

    await update(enrollmentRef, {
      status: "approved",
      reviewedAt: now,
      reviewedBy: state.currentUser.uid,
    });

    await set(ref(db, `enrollments/${subjectId}/${uid}`), {
      enrolledAt: now,
      source: "subject_approval",
      name: student.name || enrollment.studentName || "",
      studentId: student.studentId || student.schoolId || enrollment.studentId || "",
      email: student.email || enrollment.studentEmail || "",
      grade: student.grade || enrollment.studentGrade || "",
      section: student.section || enrollment.studentSection || "",
    });

    await push(ref(db, "auditLog"), {
      action: "subject_enrollment_approved",
      subjectId,
      targetUid: uid,
      reviewedBy: state.currentUser.uid,
      ts: now,
    });

    toast("Student approved for this subject.", "success");
    loadPendingApprovals();
    loadSubjects();
    loadStats();
  };

  window.appRejectSubjectEnrollment = async (subjectId, uid) => {
    if (!confirm("Reject this student for this subject?")) return;

    const subjectSnap = await get(ref(db, `subjects/${subjectId}`));
    if (!subjectSnap.exists()) {
      toast("Subject no longer exists.", "error");
      loadPendingApprovals();
      return;
    }

    const subject = subjectSnap.val();
    if (subject.instructorId !== state.currentUser.uid) {
      toast("You can only reject students for your own subjects.", "error");
      return;
    }

    const enrollmentRef = ref(db, `subjectEnrollments/${subjectId}/${uid}`);
    const enrollmentSnap = await get(enrollmentRef);
    if (!enrollmentSnap.exists()) {
      toast("Subject request no longer exists.", "info");
      loadPendingApprovals();
      return;
    }

    await update(enrollmentRef, {
      status: "rejected",
      reviewedAt: Date.now(),
      reviewedBy: state.currentUser.uid,
    });

    await push(ref(db, "auditLog"), {
      action: "subject_enrollment_rejected",
      subjectId,
      targetUid: uid,
      reviewedBy: state.currentUser.uid,
      ts: Date.now(),
    });

    toast("Student rejected for this subject.", "info");
    loadPendingApprovals();
  };
}
