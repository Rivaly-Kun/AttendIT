/* =========================================================
   AttendIT — Main Application Entry Point
   =========================================================
   Imports all modules, wires navigation / modal handlers,
   and kicks off authentication.
   ========================================================= */

import { $, $$, showSection, closeModal, toast } from "./helpers.js";
import state from "./state.js";
import { setupAuth } from "./auth.js";
import { loadSubjects, setupSubjectListeners } from "./subjects.js";
import {
  loadSessions,
  refreshMonitorSelect,
  stopMonitorAttendance,
  setupSessionListeners,
} from "./sessions.js";
import { loadStats } from "./stats.js";
import { setupReportListeners } from "./reports.js";
import { loadPendingApprovals, setupApprovalListeners } from "./approvals.js";
import {
  initStudentDashboard,
  initScanSection,
  setupStudentListeners,
} from "./student.js";

/* ===========================================================
   INSTRUCTOR DASHBOARD INIT
   =========================================================== */
function initInstructorDashboard() {
  loadSubjects();
  loadSessions();
  loadStats();
  loadPendingApprovals();
}

/* ===========================================================
   MODAL HANDLERS
   =========================================================== */
$("#modal-close").addEventListener("click", closeModal);
$("#modal-overlay").addEventListener("click", (e) => {
  if (e.target === $("#modal-overlay")) closeModal();
});

/* ===========================================================
   NAVIGATION — Instructor
   =========================================================== */
$$("#instructor-page .nav-item").forEach((n) => {
  n.addEventListener("click", () => {
    showSection(n.dataset.section, $("#instructor-page"));

    if (n.dataset.section === "inst-monitor") {
      refreshMonitorSelect();
      return;
    }

    /* Clean up monitor resources whenever leaving monitor section */
    if (state.qrInterval) {
      clearInterval(state.qrInterval);
      state.qrInterval = null;
    }
    stopMonitorAttendance();

    if (n.dataset.section === "inst-approvals") {
      loadPendingApprovals();
    }
  });
});

/* ===========================================================
   NAVIGATION — Student
   =========================================================== */
$$("#student-page .nav-item").forEach((n) => {
  n.addEventListener("click", () => {
    const approvalStatus = state.currentUserData?.approvalStatus || "approved";
    if (
      approvalStatus !== "approved" &&
      n.dataset.section !== "stu-dashboard"
    ) {
      toast(
        "Your account is not approved yet. You can only view your dashboard for now.",
        "info",
      );
      return;
    }

    showSection(n.dataset.section, $("#student-page"));
    if (n.dataset.section === "stu-scan") initScanSection();
  });
});

/* ===========================================================
   WIRE UP ALL MODULE LISTENERS
   =========================================================== */
setupSubjectListeners();
setupSessionListeners();
setupReportListeners();
setupStudentListeners();
setupApprovalListeners();

/* ===========================================================
   LEGACY API COMPATIBILITY
   =========================================================== */
window.mgt = window.mgt || {};
window.mgt.clearMarks = (...args) => {
  if (typeof window.appClearMarks === "function") {
    return window.appClearMarks(...args);
  }
  console.warn(
    "mgt.clearMarks() called but no clearMarks handler is available.",
  );
};

/* ===========================================================
   AUTHENTICATION (starts the app)
   =========================================================== */
setupAuth(initInstructorDashboard, initStudentDashboard);
