/* =========================================================
   AttendIT — Subjects & Enrollment Management
   ========================================================= */

import { db, ref, set, get, push, update, remove } from "./firebase-init.js";
import { $, toast, openModal, closeModal, escHtml } from "./helpers.js";
import state from "./state.js";
import { loadStats } from "./stats.js";
import {
  fetchAcademicStructure,
  getGradeOptions,
  getSectionOptions,
  validateGradeSection,
  validateStudentAcademicData,
} from "./academic.js";

function formatAcademicLabel(grade, section) {
  const g = (grade || "").toString().trim();
  const s = (section || "").toString().trim();
  if (!g && !s) return "No grade/section assigned";
  if (!g) return `No grade assigned (section ${s})`;
  if (!s) return `${g} (section missing)`;
  return `${g} - Section ${s}`;
}

function populateGradeSelect(selectEl, structure, preferred = "") {
  const grades = getGradeOptions(structure);
  selectEl.innerHTML = '<option value="">Select grade</option>';
  grades.forEach((grade) => {
    const opt = document.createElement("option");
    opt.value = grade;
    opt.textContent = grade;
    selectEl.appendChild(opt);
  });
  selectEl.value = grades.includes(preferred) ? preferred : "";
}

function populateSectionSelect(
  selectEl,
  structure,
  grade,
  preferredSection = "",
) {
  const sections = getSectionOptions(structure, grade);
  selectEl.innerHTML = '<option value="">Select section</option>';
  sections.forEach((section) => {
    const opt = document.createElement("option");
    opt.value = section;
    opt.textContent = section;
    selectEl.appendChild(opt);
  });
  selectEl.value = sections.includes(preferredSection) ? preferredSection : "";
}

/* ===========================================================
   LOAD SUBJECTS
   =========================================================== */
export async function loadSubjects() {
  const snap = await get(ref(db, "subjects"));
  const list = $("#subjects-list");
  list.innerHTML = "";
  const reportFilter = $("#report-subject-filter");
  reportFilter.innerHTML = '<option value="">All Subjects</option>';

  if (!snap.exists()) {
    list.innerHTML =
      '<div class="empty-state"><i class="fas fa-book"></i><p>No subjects yet - create one to get started</p></div>';
    return;
  }

  const subjects = snap.val();
  let count = 0;

  for (const id of Object.keys(subjects)) {
    const s = subjects[id];
    if (s.instructorId !== state.currentUser.uid) continue;
    count++;

    const enrollSnap = await get(ref(db, `enrollments/${id}`));
    const enrolledCount = enrollSnap.exists()
      ? Object.keys(enrollSnap.val()).length
      : 0;

    const card = document.createElement("div");
    card.className = "subject-card";
    card.innerHTML = `
      <div class="subject-card-header">
        <h4>${escHtml(s.name)}</h4>
        <span class="badge badge-present">${enrolledCount} student${enrolledCount !== 1 ? "s" : ""}</span>
      </div>
      <p class="subject-meta">${escHtml(s.code || "")} &bull; ${escHtml(s.schedule || "")}</p>
      <p class="subject-meta">${escHtml(formatAcademicLabel(s.grade, s.section))}</p>
      <p class="subject-meta">Late threshold: ${s.lateThreshold || 15} min</p>
      <div class="subject-actions">
        <button class="btn btn-sm btn-primary" onclick="window.appManageStudents('${id}')"><i class="fas fa-users"></i> Students</button>
        <button class="btn btn-sm btn-secondary" onclick="window.appEditSubject('${id}')"><i class="fas fa-edit"></i> Edit</button>
        <button class="btn btn-sm btn-danger" onclick="window.appDeleteSubject('${id}')"><i class="fas fa-trash"></i></button>
      </div>`;
    list.appendChild(card);

    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = s.name;
    reportFilter.appendChild(opt);
  }

  if (!count)
    list.innerHTML =
      '<div class="empty-state"><i class="fas fa-book"></i><p>No subjects yet - create one to get started</p></div>';
}

/* ===========================================================
   SETUP LISTENERS (Add / Edit / Delete / Enrollment)
   =========================================================== */
export function setupSubjectListeners() {
  /* ---- Add Subject ---- */
  $("#btn-add-subject").addEventListener("click", async () => {
    const academicStructure = await fetchAcademicStructure();

    openModal(
      "Add Subject",
      `
      <div class="form-group"><label>Subject Name</label><input id="m-subj-name" placeholder="e.g. Data Structures" required /></div>
      <div class="form-group"><label>Subject Code</label><input id="m-subj-code" placeholder="e.g. CS201" /></div>
      <div class="form-group"><label>Grade</label><select id="m-subj-grade"></select></div>
      <div class="form-group"><label>Section</label><select id="m-subj-section"></select></div>
      <div class="form-group"><label>Schedule</label><input id="m-subj-sched" placeholder="e.g. MWF 9:00-10:30" /></div>
      <div class="form-group"><label>Late Threshold (minutes)</label><input type="number" id="m-subj-late" value="15" min="1" /></div>
      <button class="btn btn-primary btn-full mt-8" id="m-subj-save"><i class="fas fa-check"></i> Save Subject</button>
    `,
    );

    const gradeSelect = $("#m-subj-grade");
    const sectionSelect = $("#m-subj-section");
    populateGradeSelect(gradeSelect, academicStructure);
    populateSectionSelect(sectionSelect, academicStructure, gradeSelect.value);

    gradeSelect.addEventListener("change", () => {
      populateSectionSelect(
        sectionSelect,
        academicStructure,
        gradeSelect.value,
      );
    });

    $("#m-subj-save").addEventListener("click", async () => {
      const name = $("#m-subj-name").value.trim();
      const grade = gradeSelect.value;
      const section = sectionSelect.value;
      if (!name) return toast("Subject name is required", "error");

      const sectionValidation = validateGradeSection(
        academicStructure,
        grade,
        section,
      );
      if (!sectionValidation.valid)
        return toast(sectionValidation.reason, "error");

      const newRef = push(ref(db, "subjects"));
      await set(newRef, {
        name,
        code: $("#m-subj-code").value.trim(),
        grade,
        section,
        schedule: $("#m-subj-sched").value.trim(),
        lateThreshold: parseInt($("#m-subj-late").value) || 15,
        instructorId: state.currentUser.uid,
        createdAt: Date.now(),
      });
      toast("Subject created!", "success");
      closeModal();
      loadSubjects();
      loadStats();
    });
  });

  /* ---- Edit Subject ---- */
  window.appEditSubject = async (id) => {
    const snap = await get(ref(db, `subjects/${id}`));
    if (!snap.exists()) return;
    const s = snap.val();
    const academicStructure = await fetchAcademicStructure();

    openModal(
      "Edit Subject",
      `
      <div class="form-group"><label>Subject Name</label><input id="m-subj-name" value="${escHtml(s.name)}" /></div>
      <div class="form-group"><label>Subject Code</label><input id="m-subj-code" value="${escHtml(s.code || "")}" /></div>
      <div class="form-group"><label>Grade</label><select id="m-subj-grade"></select></div>
      <div class="form-group"><label>Section</label><select id="m-subj-section"></select></div>
      <div class="form-group"><label>Schedule</label><input id="m-subj-sched" value="${escHtml(s.schedule || "")}" /></div>
      <div class="form-group"><label>Late Threshold (min)</label><input type="number" id="m-subj-late" value="${s.lateThreshold || 15}" /></div>
      <button class="btn btn-primary btn-full mt-8" id="m-subj-save"><i class="fas fa-check"></i> Update</button>
    `,
    );

    const gradeSelect = $("#m-subj-grade");
    const sectionSelect = $("#m-subj-section");
    populateGradeSelect(gradeSelect, academicStructure, s.grade || "");
    populateSectionSelect(
      sectionSelect,
      academicStructure,
      gradeSelect.value,
      s.section || "",
    );

    gradeSelect.addEventListener("change", () => {
      populateSectionSelect(
        sectionSelect,
        academicStructure,
        gradeSelect.value,
      );
    });

    $("#m-subj-save").addEventListener("click", async () => {
      const grade = gradeSelect.value;
      const section = sectionSelect.value;

      const sectionValidation = validateGradeSection(
        academicStructure,
        grade,
        section,
      );
      if (!sectionValidation.valid)
        return toast(sectionValidation.reason, "error");

      await update(ref(db, `subjects/${id}`), {
        name: $("#m-subj-name").value.trim(),
        code: $("#m-subj-code").value.trim(),
        grade,
        section,
        schedule: $("#m-subj-sched").value.trim(),
        lateThreshold: parseInt($("#m-subj-late").value) || 15,
      });
      toast("Subject updated", "success");
      closeModal();
      loadSubjects();
    });
  };

  /* ---- Delete Subject ---- */
  window.appDeleteSubject = async (id) => {
    if (!confirm("Delete this subject and all its enrollments?")) return;
    await remove(ref(db, `subjects/${id}`));
    await remove(ref(db, `enrollments/${id}`));
    toast("Subject deleted", "success");
    loadSubjects();
    loadStats();
  };

  /* ---- Manage Students (Section-based Enrollment) ---- */
  window.appManageStudents = async (subjectId) => {
    const subjSnap = await get(ref(db, `subjects/${subjectId}`));
    if (!subjSnap.exists()) {
      toast("Subject no longer exists.", "error");
      return;
    }

    const subject = subjSnap.val();
    const subjName = subject.name || subjectId;
    const subjectGrade = (subject.grade || "").trim();
    const subjectSection = (subject.section || "").trim();
    const hasSubjectSection = !!subjectGrade && !!subjectSection;

    const enrollSnap = await get(ref(db, `enrollments/${subjectId}`));
    const enrolled = enrollSnap.exists() ? enrollSnap.val() : {};

    const usersSnap = await get(ref(db, "users"));
    const allUsers = usersSnap.exists() ? usersSnap.val() : {};
    const academicStructure = await fetchAcademicStructure();

    /* Build enrolled list */
    let enrolledHTML = "";
    for (const uid of Object.keys(enrolled)) {
      const u = allUsers[uid] || {};
      const grade = u.grade || enrolled[uid].grade || "";
      const section = u.section || enrolled[uid].section || "";
      const validation = validateStudentAcademicData(academicStructure, {
        grade,
        section,
      });
      const validationBadge = validation.valid
        ? '<span class="badge badge-safe">Valid</span>'
        : '<span class="badge badge-absent">Invalid</span>';

      enrolledHTML += `
        <div class="enrolled-student-row">
          <div class="enrolled-student-info">
            <strong>${escHtml(u.name || enrolled[uid].name || "Unknown")}</strong>
            <span>${escHtml(u.studentId || enrolled[uid].studentId || "")} &bull; ${escHtml(u.email || enrolled[uid].email || "")}</span>
            <span>${escHtml(formatAcademicLabel(grade, section))} ${validationBadge}</span>
            ${
              validation.valid
                ? ""
                : `<span class="enrolled-student-warning">${escHtml(validation.reason)}</span>`
            }
          </div>
          <button class="btn btn-sm btn-danger" onclick="window.appRemoveStudent('${subjectId}','${uid}')"><i class="fas fa-user-minus"></i></button>
        </div>`;
    }
    if (!enrolledHTML)
      enrolledHTML = '<p class="empty-state-sm">No students enrolled yet</p>';

    /* Section-based candidates */
    const approvedCandidates = [];
    let pendingInSection = 0;
    let approvedButAlreadyEnrolled = 0;

    for (const uid of Object.keys(allUsers)) {
      const u = allUsers[uid] || {};
      if (u.role !== "student") continue;
      if (!hasSubjectSection) continue;

      const sameSection =
        (u.grade || "") === subjectGrade &&
        (u.section || "") === subjectSection;
      if (!sameSection) continue;

      const approvalStatus = (u.approvalStatus || "approved").toLowerCase();
      if (approvalStatus === "pending") {
        pendingInSection++;
        continue;
      }
      if (approvalStatus !== "approved") continue;

      const validation = validateStudentAcademicData(academicStructure, u);
      if (!validation.valid) continue;

      if (enrolled[uid]) {
        approvedButAlreadyEnrolled++;
        continue;
      }

      approvedCandidates.push({ uid, ...u });
    }

    const sectionLabel = formatAcademicLabel(subjectGrade, subjectSection);

    openModal(
      `Manage Students — ${escHtml(subjName)}`,
      `
      <div class="form-group">
        <label>Section-Based Add</label>
        <div class="section-chip">${escHtml(sectionLabel)}</div>
        <p class="section-hint">Approved not enrolled: <strong>${approvedCandidates.length}</strong> &bull; Pending signups: <strong>${pendingInSection}</strong> &bull; Already enrolled: <strong>${approvedButAlreadyEnrolled}</strong></p>
        <button class="btn btn-primary btn-full mt-8" id="m-add-section-btn" ${hasSubjectSection ? "" : "disabled"}><i class="fas fa-layer-group"></i> Add Approved Students From Section</button>
        ${
          hasSubjectSection
            ? ""
            : '<p class="enrolled-student-warning mt-8">This subject has no grade/section. Edit the subject first to enable section-based add.</p>'
        }
      </div>
      <div class="divider"></div>
      <label class="modal-section-label">Enrolled Students (${Object.keys(enrolled).length})</label>
      <div id="m-enrolled-list" class="enrolled-list">${enrolledHTML}</div>
    `,
    );

    $("#m-add-section-btn")?.addEventListener("click", async () => {
      if (!hasSubjectSection) {
        toast(
          "This subject has no section. Please edit subject first.",
          "error",
        );
        return;
      }

      if (!approvedCandidates.length) {
        if (pendingInSection > 0) {
          toast(
            "No approved students available in this section yet. Approve pending signups first.",
            "error",
          );
        } else {
          toast("No students found for this section.", "error");
        }
        return;
      }

      let addedCount = 0;
      for (const candidate of approvedCandidates) {
        await set(ref(db, `enrollments/${subjectId}/${candidate.uid}`), {
          name: candidate.name || "",
          studentId: candidate.studentId || "",
          email: candidate.email || "",
          grade: candidate.grade || "",
          section: candidate.section || "",
          enrolledAt: Date.now(),
        });
        addedCount++;
      }

      await push(ref(db, "auditLog"), {
        action: "section_bulk_enroll",
        subjectId,
        grade: subjectGrade,
        section: subjectSection,
        addedCount,
        userId: state.currentUser.uid,
        ts: Date.now(),
      });

      toast(
        `${addedCount} student${addedCount === 1 ? "" : "s"} added from ${subjectGrade} Section ${subjectSection}.`,
        "success",
      );
      window.appManageStudents(subjectId);
      loadSubjects();
      loadStats();
    });
  };

  /* ---- Remove Student ---- */
  window.appRemoveStudent = async (subjectId, uid) => {
    if (!confirm("Remove this student from the class?")) return;
    await remove(ref(db, `enrollments/${subjectId}/${uid}`));
    toast("Student removed", "success");
    await push(ref(db, "auditLog"), {
      action: "student_removed",
      subjectId,
      targetUid: uid,
      userId: state.currentUser.uid,
      ts: Date.now(),
    });
    window.appManageStudents(subjectId);
    loadSubjects();
    loadStats();
  };
}
