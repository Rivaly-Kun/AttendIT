/* =========================================================
   AttendIT - Admin Section Management
   ========================================================= */

import { db, ref, get, set, update, remove, push } from "./firebase-init.js";
import { $, $$, toast, escHtml } from "./helpers.js";
import state from "./state.js";
import {
  academicKey,
  cleanAcademicString,
  fetchAcademicStructureDetails,
} from "./academic.js";

let currentDetails = null;

function sortByName(a, b) {
  return (a.name || "").localeCompare(b.name || "");
}

function statusBadge(record) {
  return record.archived
    ? '<span class="badge badge-absent">Archived</span>'
    : '<span class="badge badge-safe">Active</span>';
}

function getRecordEntries(records) {
  return Object.entries(records || {})
    .map(([id, record]) => ({ id, ...record }))
    .sort(sortByName);
}

function hasDuplicateName(records, name, exceptId = "") {
  const normalized = cleanAcademicString(name).toLowerCase();
  return Object.entries(records || {}).some(([id, record]) => {
    return id !== exceptId && cleanAcademicString(record.name).toLowerCase() === normalized;
  });
}

function nextAvailableId(records, name) {
  const base = academicKey(name);
  if (!base) return "";
  if (!records?.[base]) return base;

  let index = 2;
  let candidate = `${base}_${index}`;
  while (records[candidate]) {
    index++;
    candidate = `${base}_${index}`;
  }
  return candidate;
}

async function getUsageCounts({ gradeName = "", sectionName = "" }) {
  const [usersSnap, subjectsSnap] = await Promise.all([
    get(ref(db, "users")),
    get(ref(db, "subjects")),
  ]);

  const users = usersSnap.exists() ? usersSnap.val() : {};
  const subjects = subjectsSnap.exists() ? subjectsSnap.val() : {};

  let students = 0;
  let subjectCount = 0;

  Object.values(users).forEach((user) => {
    if (user.role !== "student") return;
    if (gradeName && user.grade !== gradeName) return;
    if (sectionName && user.section !== sectionName) return;
    students++;
  });

  Object.values(subjects).forEach((subject) => {
    if (gradeName && subject.grade !== gradeName) return;
    if (sectionName && subject.section !== sectionName) return;
    subjectCount++;
  });

  return { students, subjects: subjectCount };
}

function getAssignedGradeCount(sectionId) {
  return Object.values(currentDetails?.gradeSections || {}).filter(
    (assignments) => assignments?.[sectionId],
  ).length;
}

function getGradeAssignmentCount(gradeId) {
  return Object.keys(currentDetails?.gradeSections?.[gradeId] || {}).length;
}

function renderAdminEmpty(target, message) {
  target.innerHTML = `<p class="empty-state-sm">${escHtml(message)}</p>`;
}

function renderGrades() {
  const target = $("#admin-grade-list");
  if (!target) return;

  const grades = getRecordEntries(currentDetails?.grades);
  if (!grades.length) {
    renderAdminEmpty(target, "No grade levels configured yet.");
    return;
  }

  target.innerHTML = "";
  grades.forEach((grade) => {
    const row = document.createElement("div");
    row.className = "admin-list-row";
    row.innerHTML = `
      <div>
        <strong>${escHtml(grade.name)}</strong>
        <span>${getGradeAssignmentCount(grade.id)} assigned section${getGradeAssignmentCount(grade.id) === 1 ? "" : "s"} ${statusBadge(grade)}</span>
      </div>
      <div class="action-btns">
        <button class="btn btn-sm btn-secondary" onclick="window.appEditGrade('${grade.id}')"><i class="fas fa-edit"></i></button>
        <button class="btn btn-sm btn-secondary" onclick="window.appToggleGradeArchive('${grade.id}')">
          <i class="fas ${grade.archived ? "fa-box-open" : "fa-archive"}"></i>
        </button>
        <button class="btn btn-sm btn-danger" onclick="window.appDeleteGrade('${grade.id}')"><i class="fas fa-trash"></i></button>
      </div>`;
    target.appendChild(row);
  });
}

function renderSections() {
  const target = $("#admin-section-list");
  if (!target) return;

  const sections = getRecordEntries(currentDetails?.sections);
  if (!sections.length) {
    renderAdminEmpty(target, "No global sections configured yet.");
    return;
  }

  target.innerHTML = "";
  sections.forEach((section) => {
    const assignedCount = getAssignedGradeCount(section.id);
    const row = document.createElement("div");
    row.className = "admin-list-row";
    row.innerHTML = `
      <div>
        <strong>${escHtml(section.name)}</strong>
        <span>${assignedCount} grade assignment${assignedCount === 1 ? "" : "s"} ${statusBadge(section)}</span>
      </div>
      <div class="action-btns">
        <button class="btn btn-sm btn-secondary" onclick="window.appEditSection('${section.id}')"><i class="fas fa-edit"></i></button>
        <button class="btn btn-sm btn-secondary" onclick="window.appToggleSectionArchive('${section.id}')">
          <i class="fas ${section.archived ? "fa-box-open" : "fa-archive"}"></i>
        </button>
        <button class="btn btn-sm btn-danger" onclick="window.appDeleteSection('${section.id}')"><i class="fas fa-trash"></i></button>
      </div>`;
    target.appendChild(row);
  });
}

function renderGradeAssignments() {
  const target = $("#admin-grade-section-list");
  if (!target) return;

  const activeGrades = getRecordEntries(currentDetails?.grades).filter(
    (grade) => !grade.archived,
  );
  const activeSections = getRecordEntries(currentDetails?.sections).filter(
    (section) => !section.archived,
  );

  if (!activeGrades.length || !activeSections.length) {
    target.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-layer-group"></i>
        <p>Create active grade levels and active global sections before assigning sections.</p>
      </div>`;
    return;
  }

  target.innerHTML = "";
  activeGrades.forEach((grade) => {
    const card = document.createElement("div");
    card.className = "grade-assignment-card";
    const assigned = currentDetails.gradeSections?.[grade.id] || {};
    const checkboxes = activeSections
      .map((section) => {
        const inputId = `assign-${grade.id}-${section.id}`;
        return `
          <label class="checkbox-row" for="${escHtml(inputId)}">
            <input
              type="checkbox"
              id="${escHtml(inputId)}"
              data-grade-id="${escHtml(grade.id)}"
              data-section-id="${escHtml(section.id)}"
              ${assigned[section.id] ? "checked" : ""}
            />
            <span>${escHtml(section.name)}</span>
          </label>`;
      })
      .join("");

    card.innerHTML = `
      <div class="grade-assignment-header">
        <div>
          <h4>${escHtml(grade.name)}</h4>
          <p>${Object.keys(assigned).length} section${Object.keys(assigned).length === 1 ? "" : "s"} assigned</p>
        </div>
        <button class="btn btn-sm btn-primary" onclick="window.appSaveGradeSections('${grade.id}')">
          <i class="fas fa-save"></i> Save
        </button>
      </div>
      <div class="checkbox-grid">${checkboxes}</div>`;
    target.appendChild(card);
  });
}

function renderAll() {
  renderGrades();
  renderSections();
  renderGradeAssignments();
}

export async function loadAdminSections() {
  if (state.currentRole !== "admin") return;
  currentDetails = await fetchAcademicStructureDetails();
  renderAll();
}

async function audit(action, details = {}) {
  await push(ref(db, "auditLog"), {
    action,
    actor: state.currentUser?.uid || "",
    details,
    timestamp: Date.now(),
  });
}

export function setupAdminListeners() {
  $("#admin-grade-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = $("#admin-grade-name");
    const name = cleanAcademicString(input.value);
    if (!name) return toast("Grade level name is required.", "error");

    currentDetails = currentDetails || (await fetchAcademicStructureDetails());
    if (hasDuplicateName(currentDetails.grades, name)) {
      return toast("That grade level already exists.", "error");
    }

    const id = nextAvailableId(currentDetails.grades, name);
    await set(ref(db, `academicStructure/grades/${id}`), {
      name,
      archived: false,
      createdAt: Date.now(),
      createdBy: state.currentUser.uid,
    });
    await audit("grade_created", { gradeId: id, name });
    input.value = "";
    toast("Grade level created.", "success");
    loadAdminSections();
  });

  $("#admin-section-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = $("#admin-section-name");
    const name = cleanAcademicString(input.value);
    if (!name) return toast("Section name is required.", "error");

    currentDetails = currentDetails || (await fetchAcademicStructureDetails());
    if (hasDuplicateName(currentDetails.sections, name)) {
      return toast("That section already exists.", "error");
    }

    const id = nextAvailableId(currentDetails.sections, name);
    await set(ref(db, `academicStructure/sections/${id}`), {
      name,
      archived: false,
      createdAt: Date.now(),
      createdBy: state.currentUser.uid,
    });
    await audit("section_created", { sectionId: id, name });
    input.value = "";
    toast("Section created.", "success");
    loadAdminSections();
  });

  window.appSaveGradeSections = async (gradeId) => {
    const selected = Array.from(
      $$(`input[data-grade-id="${CSS.escape(gradeId)}"]:checked`),
    ).map((input) => input.dataset.sectionId);

    const payload = selected.reduce((acc, sectionId) => {
      acc[sectionId] = true;
      return acc;
    }, {});

    await set(
      ref(db, `academicStructure/gradeSections/${gradeId}`),
      selected.length ? payload : null,
    );
    await audit("grade_sections_updated", { gradeId, sectionIds: selected });
    toast("Grade-section assignments saved.", "success");
    loadAdminSections();
  };

  window.appEditGrade = async (gradeId) => {
    currentDetails = currentDetails || (await fetchAcademicStructureDetails());
    const grade = currentDetails.grades?.[gradeId];
    if (!grade) return;

    const nextName = cleanAcademicString(
      prompt("Rename grade level", grade.name) || "",
    );
    if (!nextName || nextName === grade.name) return;
    if (hasDuplicateName(currentDetails.grades, nextName, gradeId)) {
      return toast("That grade level already exists.", "error");
    }

    const updates = {
      [`academicStructure/grades/${gradeId}/name`]: nextName,
      [`academicStructure/grades/${gradeId}/updatedAt`]: Date.now(),
    };

    const [usersSnap, subjectsSnap] = await Promise.all([
      get(ref(db, "users")),
      get(ref(db, "subjects")),
    ]);

    if (usersSnap.exists()) {
      Object.entries(usersSnap.val()).forEach(([uid, user]) => {
        if (user.grade === grade.name) updates[`users/${uid}/grade`] = nextName;
      });
    }

    if (subjectsSnap.exists()) {
      Object.entries(subjectsSnap.val()).forEach(([subjectId, subject]) => {
        if (subject.grade === grade.name) {
          updates[`subjects/${subjectId}/grade`] = nextName;
        }
      });
    }

    await update(ref(db), updates);
    await audit("grade_renamed", { gradeId, oldName: grade.name, nextName });
    toast("Grade level renamed.", "success");
    loadAdminSections();
  };

  window.appEditSection = async (sectionId) => {
    currentDetails = currentDetails || (await fetchAcademicStructureDetails());
    const section = currentDetails.sections?.[sectionId];
    if (!section) return;

    const nextName = cleanAcademicString(
      prompt("Rename section", section.name) || "",
    );
    if (!nextName || nextName === section.name) return;
    if (hasDuplicateName(currentDetails.sections, nextName, sectionId)) {
      return toast("That section already exists.", "error");
    }

    const updates = {
      [`academicStructure/sections/${sectionId}/name`]: nextName,
      [`academicStructure/sections/${sectionId}/updatedAt`]: Date.now(),
    };

    const [usersSnap, subjectsSnap] = await Promise.all([
      get(ref(db, "users")),
      get(ref(db, "subjects")),
    ]);

    if (usersSnap.exists()) {
      Object.entries(usersSnap.val()).forEach(([uid, user]) => {
        if (user.section === section.name) {
          updates[`users/${uid}/section`] = nextName;
        }
      });
    }

    if (subjectsSnap.exists()) {
      Object.entries(subjectsSnap.val()).forEach(([subjectId, subject]) => {
        if (subject.section === section.name) {
          updates[`subjects/${subjectId}/section`] = nextName;
        }
      });
    }

    await update(ref(db), updates);
    await audit("section_renamed", {
      sectionId,
      oldName: section.name,
      nextName,
    });
    toast("Section renamed.", "success");
    loadAdminSections();
  };

  window.appToggleGradeArchive = async (gradeId) => {
    currentDetails = currentDetails || (await fetchAcademicStructureDetails());
    const grade = currentDetails.grades?.[gradeId];
    if (!grade) return;

    await update(ref(db, `academicStructure/grades/${gradeId}`), {
      archived: !grade.archived,
      updatedAt: Date.now(),
      updatedBy: state.currentUser.uid,
    });
    await audit(grade.archived ? "grade_unarchived" : "grade_archived", {
      gradeId,
      name: grade.name,
    });
    toast(grade.archived ? "Grade level restored." : "Grade level archived.", "success");
    loadAdminSections();
  };

  window.appToggleSectionArchive = async (sectionId) => {
    currentDetails = currentDetails || (await fetchAcademicStructureDetails());
    const section = currentDetails.sections?.[sectionId];
    if (!section) return;

    await update(ref(db, `academicStructure/sections/${sectionId}`), {
      archived: !section.archived,
      updatedAt: Date.now(),
      updatedBy: state.currentUser.uid,
    });
    await audit(section.archived ? "section_unarchived" : "section_archived", {
      sectionId,
      name: section.name,
    });
    toast(section.archived ? "Section restored." : "Section archived.", "success");
    loadAdminSections();
  };

  window.appDeleteGrade = async (gradeId) => {
    currentDetails = currentDetails || (await fetchAcademicStructureDetails());
    const grade = currentDetails.grades?.[gradeId];
    if (!grade) return;

    const usage = await getUsageCounts({ gradeName: grade.name });
    const assignments = getGradeAssignmentCount(gradeId);
    if (usage.students || usage.subjects || assignments) {
      toast(
        "Grade level has students, subjects, or section assignments. Archive it instead.",
        "error",
      );
      return;
    }

    if (!confirm(`Delete ${grade.name}?`)) return;
    await remove(ref(db, `academicStructure/grades/${gradeId}`));
    await audit("grade_deleted", { gradeId, name: grade.name });
    toast("Grade level deleted.", "success");
    loadAdminSections();
  };

  window.appDeleteSection = async (sectionId) => {
    currentDetails = currentDetails || (await fetchAcademicStructureDetails());
    const section = currentDetails.sections?.[sectionId];
    if (!section) return;

    const usage = await getUsageCounts({ sectionName: section.name });
    const assignments = getAssignedGradeCount(sectionId);
    if (usage.students || usage.subjects || assignments) {
      toast(
        "Section has students, subjects, or grade assignments. Archive it instead.",
        "error",
      );
      return;
    }

    if (!confirm(`Delete ${section.name}?`)) return;
    await remove(ref(db, `academicStructure/sections/${sectionId}`));
    await audit("section_deleted", { sectionId, name: section.name });
    toast("Section deleted.", "success");
    loadAdminSections();
  };
}
