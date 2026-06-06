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
export function setupAuth(onInstructorLogin, onStudentLogin, onAdminLogin, onParentLogin) {
  let academicStructure = null;
  const roleSelect = $("#reg-role");
  const studentIdGroup = $("#reg-student-id-group");
  const studentIdInput = $("#reg-student-id");
  const gradeGroup = $("#reg-grade-group");
  const sectionGroup = $("#reg-section-group");
  const gradeSelect = $("#reg-grade");
  const sectionSelect = $("#reg-section");
  const studentTypeGroup = $("#reg-student-type-group");
  const studentTypeSelect = $("#reg-student-type");
  const transferFromGroup = $("#reg-transfer-from-group");
  const transferFromInput = $("#reg-transfer-from");
  const parentLinkGroup = $("#reg-parent-link-group");
  const parentLinkInput = $("#reg-parent-link");

  const loadAcademicStructure = async (force = false) => {
    if (!force && academicStructure) return academicStructure;
    academicStructure = await fetchAcademicStructure();
    return academicStructure;
  };

  const renderGradeOptions = (structure) => {
    const current = gradeSelect.value;
    const grades = getGradeOptions(structure);
    gradeSelect.innerHTML = '<option value="">Select grade</option>';
    if (!grades.length) {
      gradeSelect.innerHTML =
        '<option value="">No grade levels configured</option>';
      return;
    }
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
    if (grade && !sections.length) {
      sectionSelect.innerHTML =
        '<option value="">No sections assigned to this grade</option>';
      return;
    }
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
    const isParent = role === "parent";

    // Hide School / Employee ID for parents
    if (studentIdGroup) studentIdGroup.style.display = isParent ? "none" : "";
    if (studentIdInput) {
      studentIdInput.required = !isParent;
      if (isParent) studentIdInput.value = "";
    }

    gradeGroup.style.display = isStudent ? "" : "none";
    sectionGroup.style.display = isStudent ? "" : "none";
    gradeSelect.required = isStudent;
    sectionSelect.required = isStudent;

    studentTypeGroup.style.display = isStudent ? "" : "none";
    studentTypeSelect.required = isStudent;
    parentLinkGroup.style.display = isParent ? "" : "none";

    const isTransferee = studentTypeSelect.value === "transferee";
    transferFromGroup.style.display = isStudent && isTransferee ? "" : "none";

    if (!isStudent) {
      gradeSelect.value = "";
      sectionSelect.innerHTML = '<option value="">Select section</option>';
      studentTypeSelect.value = "";
      transferFromInput.value = "";
    }

    if (!isParent) parentLinkInput.value = "";
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

  studentTypeSelect.addEventListener("change", () => {
    syncStudentAcademicFields(roleSelect.value);
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

        if (state.currentRole === "admin") {
          showPage("admin-page");
          showSection("admin-sections", $("#admin-page"));
          $("#admin-user-name").textContent =
            state.currentUserData.name || user.email;
          onAdminLogin?.();
        } else if (state.currentRole === "instructor") {
          showPage("instructor-page");
          showSection("inst-dashboard", $("#instructor-page"));
          $("#inst-user-name").textContent =
            state.currentUserData.name || user.email;
          onInstructorLogin();
        } else if (state.currentRole === "parent") {
          showPage("parent-page");
          showSection("parent-dashboard", $("#parent-page"));
          $("#parent-user-name").textContent =
            state.currentUserData.name || user.email;
          onParentLogin?.();
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
    const role = $("#reg-role").value;
    const sid = role !== "parent" ? $("#reg-student-id").value.trim() : "";
    const grade = gradeSelect.value;
    const section = sectionSelect.value;
    const studentType = studentTypeSelect.value;
    const transferFrom = transferFromInput.value.trim();
    const pass = $("#reg-password").value;
    try {
      let academicPayload = {};
      if (role === "student") {
        const structure = await loadAcademicStructure(true);
        const validation = validateGradeSection(structure, grade, section);
        if (!validation.valid) throw new Error(validation.reason);
        if (!studentType) throw new Error("Student type is required.");
        if (studentType === "transferee" && !transferFrom) {
          throw new Error("Previous school is required for transferees.");
        }
        academicPayload = {
          grade,
          section,
          approvalStatus: "pending",
          approvalRequestedAt: Date.now(),
          studentType,
          transferFrom: transferFrom || "",
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

      // Auto-link child if parent provided a code during registration
      if (role === "parent" && parentLinkInput.value.trim()) {
        try {
          const linkCode = parentLinkInput.value.trim().toUpperCase();
          let childUid = null;
          let childData = null;

          // Try invite code lookup
          const inviteSnap = await get(ref(db, `inviteCodes/${linkCode}`));
          if (inviteSnap.exists()) {
            childUid = inviteSnap.val().uid;
            const uSnap = await get(ref(db, `users/${childUid}`));
            if (uSnap.exists()) childData = uSnap.val();
          }

          // Try school ID lookup
          if (!childUid) {
            const usersSnap = await get(ref(db, "users"));
            if (usersSnap.exists()) {
              for (const [uid, ud] of Object.entries(usersSnap.val())) {
                if (
                  ud.role === "student" &&
                  ud.studentId &&
                  ud.studentId.toUpperCase() === linkCode
                ) {
                  childUid = uid;
                  childData = ud;
                  break;
                }
              }
            }
          }

          if (childUid && childData) {
            await set(ref(db, `parentLinks/${cred.user.uid}/${childUid}`), {
              childName: childData.name || "",
              childStudentId: childData.studentId || "",
              childGrade: childData.grade || "",
              childSection: childData.section || "",
              linkedAt: Date.now(),
            });
            toast("Account created & child linked!", "success");
          } else {
            toast("Account created! Could not find child with that code.", "info");
          }
        } catch (linkErr) {
          console.error("Auto-link failed:", linkErr);
          toast("Account created! Child linking failed — try again from dashboard.", "info");
        }
      } else {
        toast("Account created!", "success");
      }
    } catch (err) {
      errEl.textContent = err.message.replace("Firebase: ", "");
      errEl.classList.add("visible");
    }
  });

  /* ---------- Logout ---------- */
  $("#admin-logout")?.addEventListener("click", () => signOut(auth));
  $("#inst-logout")?.addEventListener("click", () => signOut(auth));
  $("#stu-logout")?.addEventListener("click", () => signOut(auth));
  $("#parent-logout")?.addEventListener("click", () => signOut(auth));
}
