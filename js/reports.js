/* =========================================================
   AttendIT — Reports & Export
   ========================================================= */

import { db, ref, get } from "./firebase-init.js";
import { $, toast, escHtml, riskBadge } from "./helpers.js";
import state from "./state.js";

function parseLocalDateStart(value) {
  if (!value) return 0;
  const [year, month, day] = value.split("-").map((part) => Number(part));
  if (!year || !month || !day) return 0;
  return new Date(year, month - 1, day, 0, 0, 0, 0).getTime();
}

function parseLocalDateEnd(value) {
  if (!value) return Infinity;
  const [year, month, day] = value.split("-").map((part) => Number(part));
  if (!year || !month || !day) return Infinity;
  return new Date(year, month - 1, day, 23, 59, 59, 999).getTime();
}

/* ===========================================================
   GENERATE REPORT
   =========================================================== */
export async function generateReport() {
  const subjectFilter = $("#report-subject-filter").value;
  const dateFromValue = $("#report-date-from").value;
  const dateToValue = $("#report-date-to").value;
  const dateFrom = parseLocalDateStart(dateFromValue);
  const dateTo = parseLocalDateEnd(dateToValue);

  if (
    Number.isFinite(dateFrom) &&
    Number.isFinite(dateTo) &&
    dateFrom > dateTo
  ) {
    toast("Invalid date range: From date must be before To date.", "error");
    return;
  }

  const sessSnap = await get(ref(db, "sessions"));
  const attSnap = await get(ref(db, "attendance"));
  const usersSnap = await get(ref(db, "users"));
  if (!sessSnap.exists()) return toast("No sessions found", "info");

  const sessions = sessSnap.val();
  const attendance = attSnap.exists() ? attSnap.val() : {};
  const users = usersSnap.exists() ? usersSnap.val() : {};

  const relevantSessions = Object.entries(sessions).filter(([, s]) => {
    if (s.instructorId !== state.currentUser.uid) return false;
    if (subjectFilter && s.subjectId !== subjectFilter) return false;
    const sessionTime = Number(s.createdAt || 0);
    if (!sessionTime) return false;
    if (sessionTime < dateFrom || sessionTime > dateTo) return false;
    return true;
  });

  const tbody = $("#report-tbody");
  tbody.innerHTML = "";

  if (!relevantSessions.length) {
    tbody.innerHTML =
      '<tr><td colspan="7" style="text-align:center;padding:24px;opacity:.6">No sessions match the selected filters</td></tr>';
    return;
  }

  const stats = {};
  const totalSessions = relevantSessions.length;
  relevantSessions.forEach(([sessId]) => {
    const records = attendance[sessId] || {};
    Object.keys(records).forEach((uid) => {
      if (!stats[uid]) stats[uid] = { present: 0, late: 0, absent: 0 };
      const st = records[uid].status;
      if (st === "present") stats[uid].present++;
      else if (st === "late") stats[uid].late++;
      else stats[uid].absent++;
    });
  });

  /* Fill missing sessions as absent */
  Object.keys(stats).forEach((uid) => {
    const attended = stats[uid].present + stats[uid].late + stats[uid].absent;
    stats[uid].absent += Math.max(0, totalSessions - attended);
  });

  const allIds = Object.keys(stats);
  if (!allIds.length) {
    tbody.innerHTML =
      '<tr><td colspan="7" style="text-align:center;padding:24px;opacity:.6">No attendance records found for the selected sessions</td></tr>';
    return;
  }
  allIds.forEach((uid) => {
    const u = users[uid] || {};
    const s = stats[uid];
    const total = s.present + s.late + s.absent;
    const pct = total ? Math.round(((s.present + s.late) / total) * 100) : 0;
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${escHtml(u.studentId || "-")}</td><td>${escHtml(u.name || "-")}</td><td>${s.present}</td><td>${s.late}</td><td>${s.absent}</td><td><strong>${pct}%</strong></td><td>${riskBadge(pct)}</td>`;
    tbody.appendChild(tr);
  });
}

/* ===========================================================
   LEGACY COMPAT — clearMarks
   =========================================================== */
export async function clearMarks() {
  const subjectFilter = $("#report-subject-filter");
  const dateFrom = $("#report-date-from");
  const dateTo = $("#report-date-to");

  if (subjectFilter) subjectFilter.value = "";
  if (dateFrom) dateFrom.value = "";
  if (dateTo) dateTo.value = "";

  await generateReport();
  toast("Report filters cleared", "success");
}

/* ===========================================================
   SETUP REPORT LISTENERS
   =========================================================== */
export function setupReportListeners() {
  window.appClearMarks = () => clearMarks();

  $("#btn-generate-report").addEventListener("click", generateReport);

  /* ---- PDF Export ---- */
  $("#btn-export-pdf").addEventListener("click", () => {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    doc.setFontSize(18);
    doc.text("AttendIT — Attendance Report", 14, 22);
    doc.setFontSize(10);
    doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 30);
    doc.autoTable({
      html: "#report-table",
      startY: 36,
      styles: { fontSize: 9 },
      headStyles: { fillColor: [79, 70, 229] },
    });
    doc.save("attendance-report.pdf");
    toast("PDF downloaded", "success");
  });

  /* ---- Excel Export ---- */
  $("#btn-export-excel").addEventListener("click", () => {
    const wb = XLSX.utils.table_to_book($("#report-table"), {
      sheet: "Attendance",
    });
    XLSX.writeFile(wb, "attendance-report.xlsx");
    toast("Excel downloaded", "success");
  });
}
