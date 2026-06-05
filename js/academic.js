/* =========================================================
   AttendIT - Database-Driven Grade & Section Validation
   ========================================================= */

import { db, ref, get } from "./firebase-init.js";

export function cleanAcademicString(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function academicKey(value) {
  return cleanAcademicString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function compareGradeLabels(a, b) {
  const numberA = Number.parseInt(a.replace(/\D+/g, ""), 10);
  const numberB = Number.parseInt(b.replace(/\D+/g, ""), 10);

  if (
    Number.isFinite(numberA) &&
    Number.isFinite(numberB) &&
    numberA !== numberB
  )
    return numberA - numberB;

  return a.localeCompare(b);
}

function normalizeRecordMap(raw, legacyValues = []) {
  const normalized = {};

  if (Array.isArray(legacyValues)) {
    legacyValues.forEach((value) => {
      const name = cleanAcademicString(value);
      const key = academicKey(name);
      if (name && key) normalized[key] = { name, archived: false };
    });
  }

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return normalized;
  }

  Object.entries(raw).forEach(([key, value]) => {
    if (value === false || value == null) return;

    if (typeof value === "string") {
      const name = cleanAcademicString(value);
      if (name) normalized[key] = { name, archived: false };
      return;
    }

    if (value === true) {
      const name = cleanAcademicString(key);
      if (name) normalized[key] = { name, archived: false };
      return;
    }

    if (typeof value === "object") {
      const name = cleanAcademicString(value.name || key);
      if (!name) return;
      normalized[key] = {
        ...value,
        name,
        archived: value.archived === true,
      };
    }
  });

  return normalized;
}

function buildLegacyGradeSections(raw) {
  const normalized = {};
  if (!raw || typeof raw !== "object") return normalized;

  if (
    !raw.gradeSections &&
    Array.isArray(raw.grades) &&
    Array.isArray(raw.sections)
  ) {
    raw.grades.forEach((gradeValue) => {
      const grade = cleanAcademicString(gradeValue);
      if (!grade) return;
      normalized[grade] = raw.sections
        .map((section) => cleanAcademicString(section))
        .filter((section) => !!section);
    });
    return normalized;
  }

  const source =
    raw.gradeSections && typeof raw.gradeSections === "object"
      ? raw.gradeSections
      : raw;

  Object.entries(source).forEach(([gradeKey, sectionsRaw]) => {
    const grade = cleanAcademicString(gradeKey);
    if (
      !grade ||
      grade === "grades" ||
      grade === "sections" ||
      grade === "currentSchoolYear"
    )
      return;

    let sectionValues = [];
    if (Array.isArray(sectionsRaw)) {
      sectionValues = sectionsRaw;
    } else if (sectionsRaw && typeof sectionsRaw === "object") {
      sectionValues = Object.entries(sectionsRaw)
        .filter(([, value]) => value !== false && value != null)
        .map(([key, value]) =>
          typeof value === "object" && value?.name ? value.name : key,
        );
    }

    const sections = Array.from(
      new Set(
        sectionValues
          .map((section) => cleanAcademicString(section))
          .filter((section) => !!section),
      ),
    );

    if (sections.length) normalized[grade] = sections;
  });

  return normalized;
}

export function normalizeAcademicDetails(raw) {
  const grades = normalizeRecordMap(raw?.grades);
  const sections = normalizeRecordMap(raw?.sections);
  const gradeSections = {};

  const legacyGradeSections = buildLegacyGradeSections(raw);
  Object.entries(legacyGradeSections).forEach(([gradeName, sectionNames]) => {
    const gradeId = academicKey(gradeName);
    if (!gradeId) return;
    if (!grades[gradeId]) grades[gradeId] = { name: gradeName, archived: false };
    gradeSections[gradeId] = gradeSections[gradeId] || {};

    sectionNames.forEach((sectionName) => {
      const sectionId = academicKey(sectionName);
      if (!sectionId) return;
      if (!sections[sectionId]) {
        sections[sectionId] = { name: sectionName, archived: false };
      }
      gradeSections[gradeId][sectionId] = true;
    });
  });

  if (raw?.gradeSections && typeof raw.gradeSections === "object") {
    Object.entries(raw.gradeSections).forEach(([gradeKey, assignedRaw]) => {
      const gradeId = grades[gradeKey] ? gradeKey : academicKey(gradeKey);
      if (!gradeId) return;
      if (!grades[gradeId]) {
        grades[gradeId] = { name: gradeKey, archived: false };
      }
      gradeSections[gradeId] = gradeSections[gradeId] || {};

      if (Array.isArray(assignedRaw)) {
        assignedRaw.forEach((sectionName) => {
          const sectionId = academicKey(sectionName);
          if (!sectionId) return;
          if (!sections[sectionId]) {
            sections[sectionId] = {
              name: cleanAcademicString(sectionName),
              archived: false,
            };
          }
          gradeSections[gradeId][sectionId] = true;
        });
        return;
      }

      if (assignedRaw && typeof assignedRaw === "object") {
        Object.entries(assignedRaw).forEach(([sectionKey, assigned]) => {
          if (assigned === false || assigned == null) return;
          const sectionId = sections[sectionKey]
            ? sectionKey
            : academicKey(
                typeof assigned === "object" && assigned?.name
                  ? assigned.name
                  : sectionKey,
              );
          if (!sectionId) return;
          if (!sections[sectionId]) {
            sections[sectionId] = {
              name:
                typeof assigned === "object" && assigned?.name
                  ? cleanAcademicString(assigned.name)
                  : sectionKey,
              archived: false,
            };
          }
          gradeSections[gradeId][sectionId] = true;
        });
      }
    });
  }

  return {
    grades,
    sections,
    gradeSections,
    currentSchoolYear: raw?.currentSchoolYear || "",
  };
}

export function activeAcademicStructureFromDetails(details) {
  const structure = {};

  Object.entries(details?.grades || {})
    .filter(([, grade]) => !grade.archived)
    .sort(([, a], [, b]) => compareGradeLabels(a.name, b.name))
    .forEach(([gradeId, grade]) => {
      const activeSections = Object.keys(details.gradeSections?.[gradeId] || {})
        .map((sectionId) => details.sections?.[sectionId])
        .filter((section) => section && !section.archived)
        .map((section) => section.name)
        .sort((a, b) => a.localeCompare(b));

      structure[grade.name] = activeSections;
    });

  return structure;
}

export async function fetchAcademicStructureDetails() {
  try {
    const snap = await get(ref(db, "academicStructure"));
    return normalizeAcademicDetails(snap.exists() ? snap.val() : {});
  } catch (err) {
    console.error("Failed to load academic structure:", err);
    return normalizeAcademicDetails({});
  }
}

export async function fetchAcademicStructure() {
  const details = await fetchAcademicStructureDetails();
  return activeAcademicStructureFromDetails(details);
}

export function getGradeOptions(structure) {
  return Object.keys(structure || {}).sort(compareGradeLabels);
}

export function getSectionOptions(structure, grade) {
  const selectedGrade = cleanAcademicString(grade);
  if (!selectedGrade) return [];
  return [...(structure?.[selectedGrade] || [])].sort((a, b) =>
    a.localeCompare(b),
  );
}

export function validateGradeSection(structure, grade, section) {
  const selectedGrade = cleanAcademicString(grade);
  const selectedSection = cleanAcademicString(section);
  const gradeOptions = getGradeOptions(structure);

  if (!gradeOptions.length) {
    return {
      valid: false,
      reason:
        "No grade levels are configured yet. Ask an admin to create grade levels and sections first.",
    };
  }

  if (!selectedGrade) return { valid: false, reason: "Grade is required." };
  if (!selectedSection) return { valid: false, reason: "Section is required." };

  if (!gradeOptions.includes(selectedGrade)) {
    return {
      valid: false,
      reason: `Grade "${selectedGrade}" does not exist in the system.`,
    };
  }

  const sectionOptions = getSectionOptions(structure, selectedGrade);
  if (!sectionOptions.length) {
    return {
      valid: false,
      reason: `No active sections are assigned to ${selectedGrade}. Ask an admin to assign sections first.`,
    };
  }

  if (!sectionOptions.includes(selectedSection)) {
    return {
      valid: false,
      reason: `Section "${selectedSection}" is not valid for ${selectedGrade}.`,
    };
  }

  return { valid: true, reason: "" };
}

export function validateStudentAcademicData(structure, studentData) {
  return validateGradeSection(
    structure,
    studentData?.grade || "",
    studentData?.section || "",
  );
}
