/* =========================================================
   AttendIT — Authentication Module
   ========================================================= */

import {
  auth,
  db,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile,
  ref,
  set,
  get,
} from "./firebase-init.js";
import { $, $$, toast, showPage, showSection } from "./helpers.js";
import state, { cleanup } from "./state.js";
import {
  fetchAcademicStructure,
  getGradeOptions,
  getSectionOptions,
  validateGradeSection,
} from "./academic.js";

/**
 * Sets up authentication: login/register forms, auth-state listener,
 * and logout buttons. Calls the appropriate callback on login.
 */
export function setupAuth(onInstructorLogin, onStudentLogin) {
  let academicStructure = null;
  const roleSelect = $("#reg-role");
  const gradeGroup = $("#reg-grade-group");
  const sectionGroup = $("#reg-section-group");
  const gradeSelect = $("#reg-grade");
  const sectionSelect = $("#reg-section");

  const loadAcademicStructure = async () => {
    if (academicStructure) return academicStructure;
    academicStructure = await fetchAcademicStructure();
    return academicStructure;
  };

  const renderGradeOptions = (structure) => {
    const current = gradeSelect.value;
    const grades = getGradeOptions(structure);
    gradeSelect.innerHTML = '<option value="">Select grade</option>';
    grades.forEach((grade) => {
      const opt = document.createElement("option");
      opt.value = grade;
      opt.textContent = grade;
      gradeSelect.appendChild(opt);
    });
    gradeSelect.value = grades.includes(current) ? current : "";
  };

  const renderSectionOptions = (structure, grade, preferredSection = "") => {
    const sections = getSectionOptions(structure, grade);
    sectionSelect.innerHTML = '<option value="">Select section</option>';
    sections.forEach((section) => {
      const opt = document.createElement("option");
      opt.value = section;
      opt.textContent = section;
      sectionSelect.appendChild(opt);
    });
    sectionSelect.value = sections.includes(preferredSection)
      ? preferredSection
      : "";
  };

  const syncStudentAcademicFields = (role) => {
    const isStudent = role === "student";
    gradeGroup.style.display = isStudent ? "" : "none";
    sectionGroup.style.display = isStudent ? "" : "none";
    gradeSelect.required = isStudent;
    sectionSelect.required = isStudent;

    if (!isStudent) {
      gradeSelect.value = "";
      sectionSelect.innerHTML = '<option value="">Select section</option>';
    }
  };

  loadAcademicStructure()
    .then((structure) => {
      renderGradeOptions(structure);
      renderSectionOptions(structure, gradeSelect.value);
      syncStudentAcademicFields(roleSelect.value);
    })
    .catch((err) => {
      console.error("Failed to initialize grade/section options:", err);
      syncStudentAcademicFields(roleSelect.value);
    });

  roleSelect.addEventListener("change", async () => {
    syncStudentAcademicFields(roleSelect.value);
    if (roleSelect.value !== "student") return;
    const structure = await loadAcademicStructure();
    if (!gradeSelect.options.length || gradeSelect.options.length === 1)
      renderGradeOptions(structure);
    renderSectionOptions(structure, gradeSelect.value, sectionSelect.value);
  });

  gradeSelect.addEventListener("change", async () => {
    const structure = await loadAcademicStructure();
    renderSectionOptions(structure, gradeSelect.value);
  });

  /* ---------- Auth state change ---------- */
  onAuthStateChanged(auth, async (user) => {
    cleanup();

    if (user) {
      state.currentUser = user;
      const snap = await get(ref(db, `users/${user.uid}`));

      if (snap.exists()) {
        state.currentUserData = snap.val();
        state.currentRole = state.currentUserData.role;

        if (state.currentRole === "instructor") {
          showPage("instructor-page");
          showSection("inst-dashboard", $("#instructor-page"));
          $("#inst-user-name").textContent =
            state.currentUserData.name || user.email;
          onInstructorLogin();
        } else {
          state.currentUserData.approvalStatus =
            state.currentUserData.approvalStatus || "approved";
          showPage("student-page");
          showSection("stu-dashboard", $("#student-page"));
          $("#stu-user-name").textContent =
            state.currentUserData.name || user.email;
          onStudentLogin();

          if (state.currentUserData.approvalStatus === "pending") {
            toast(
              "Your account is pending teacher approval. Dashboard access is limited.",
              "info",
            );
          } else if (state.currentUserData.approvalStatus === "rejected") {
            toast(
              "Your signup request was rejected. Please contact your teacher.",
              "error",
            );
          }
        }
      } else {
        toast("Account data not found. Please register again.", "error");
        signOut(auth);
      }
    } else {
      state.currentUser = null;
      state.currentRole = null;
      state.currentUserData = null;
      window._studentHistoryRows = [];
      window._subjects = {};
      showPage("auth-page");
    }
  });

  /* ---------- Auth tabs ---------- */
  $$(".auth-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      $$(".auth-tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      $$(".auth-form").forEach((f) => f.classList.remove("active"));
      $(`#${tab.dataset.tab}-form`).classList.add("active");
    });
  });

  /* ---------- Login ---------- */
  $("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errEl = $("#login-error");
    errEl.classList.remove("visible");
    try {
      await signInWithEmailAndPassword(
        auth,
        $("#login-email").value.trim(),
        $("#login-password").value,
      );
      toast("Signed in successfully", "success");
    } catch (err) {
      errEl.textContent = err.message.replace("Firebase: ", "");
      errEl.classList.add("visible");
    }
  });

  /* ---------- Register ---------- */
  $("#register-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errEl = $("#register-error");
    errEl.classList.remove("visible");
    const name = $("#reg-name").value.trim();
    const email = $("#reg-email").value.trim();
    const sid = $("#reg-student-id").value.trim();
    const role = $("#reg-role").value;
    const grade = gradeSelect.value;
    const section = sectionSelect.value;
    const pass = $("#reg-password").value;
    try {
      let academicPayload = {};
      if (role === "student") {
        const structure = await loadAcademicStructure();
        const validation = validateGradeSection(structure, grade, section);
        if (!validation.valid) throw new Error(validation.reason);
        academicPayload = {
          grade,
          section,
          approvalStatus: "pending",
          approvalRequestedAt: Date.now(),
        };
      }

      const cred = await createUserWithEmailAndPassword(auth, email, pass);
      await updateProfile(cred.user, { displayName: name });
      await set(ref(db, `users/${cred.user.uid}`), {
        name,
        email,
        studentId: sid,
        role,
        ...academicPayload,
        createdAt: Date.now(),
      });
      toast("Account created!", "success");
    } catch (err) {
      errEl.textContent = err.message.replace("Firebase: ", "");
      errEl.classList.add("visible");
    }
  });

  /* ---------- Logout ---------- */
  $("#inst-logout").addEventListener("click", () => signOut(auth));
  $("#stu-logout").addEventListener("click", () => signOut(auth));
}
