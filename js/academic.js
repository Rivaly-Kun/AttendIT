/* =========================================================
   AttendIT — Grade & Section Validation
   ========================================================= */

import { db, ref, get } from "./firebase-init.js";

const FALLBACK_ACADEMIC_STRUCTURE = {
  "Grade 7": ["A", "B", "C", "D"],
  "Grade 8": ["A", "B", "C", "D"],
  "Grade 9": ["A", "B", "C", "D"],
  "Grade 10": ["A", "B", "C", "D"],
  "Grade 11": ["A", "B", "C", "D"],
  "Grade 12": ["A", "B", "C", "D"],
};

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeAcademicStructure(raw) {
  const normalized = {};
  if (!raw || typeof raw !== "object") return normalized;

  Object.entries(raw).forEach(([gradeKey, sectionsRaw]) => {
    const grade = cleanString(gradeKey);
    if (!grade) return;

    let sectionValues = [];

    if (Array.isArray(sectionsRaw)) {
      sectionValues = sectionsRaw;
    } else if (sectionsRaw && typeof sectionsRaw === "object") {
      sectionValues = Object.entries(sectionsRaw)
        .filter(([, enabled]) => enabled !== false && enabled != null)
        .map(([section]) => section);
    }

    const sections = Array.from(
      new Set(
        sectionValues
          .map((section) => cleanString(section))
          .filter((section) => !!section),
      ),
    );

    if (sections.length) normalized[grade] = sections;
  });

  return normalized;
}

function defaultAcademicStructure() {
  return JSON.parse(JSON.stringify(FALLBACK_ACADEMIC_STRUCTURE));
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

export async function fetchAcademicStructure() {
  try {
    const snap = await get(ref(db, "academicStructure"));
    if (!snap.exists()) return defaultAcademicStructure();

    const normalized = normalizeAcademicStructure(snap.val());
    if (!Object.keys(normalized).length) return defaultAcademicStructure();

    return normalized;
  } catch (err) {
    console.error("Failed to load academic structure:", err);
    return defaultAcademicStructure();
  }
}

export function getGradeOptions(structure) {
  return Object.keys(structure || {}).sort(compareGradeLabels);
}

export function getSectionOptions(structure, grade) {
  const selectedGrade = cleanString(grade);
  if (!selectedGrade) return [];
  return [...(structure?.[selectedGrade] || [])].sort((a, b) =>
    a.localeCompare(b),
  );
}

export function validateGradeSection(structure, grade, section) {
  const selectedGrade = cleanString(grade);
  const selectedSection = cleanString(section);

  if (!selectedGrade) return { valid: false, reason: "Grade is required." };
  if (!selectedSection) return { valid: false, reason: "Section is required." };

  const gradeOptions = getGradeOptions(structure);
  if (!gradeOptions.includes(selectedGrade)) {
    return {
      valid: false,
      reason: `Grade "${selectedGrade}" does not exist in the system.`,
    };
  }

  const sectionOptions = getSectionOptions(structure, selectedGrade);
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
