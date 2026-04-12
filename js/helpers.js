/* =========================================================
   AttendIT — DOM & Utility Helpers
   ========================================================= */

export const $ = (sel) => document.querySelector(sel);
export const $$ = (sel) => document.querySelectorAll(sel);

export function show(el) {
  if (typeof el === "string") el = $(el);
  if (el) el.style.display = "";
}

export function hide(el) {
  if (typeof el === "string") el = $(el);
  if (el) el.style.display = "none";
}

export function toast(msg, type = "info") {
  const c = $("#toast-container");
  const t = document.createElement("div");
  t.className = `toast ${type}`;
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

export function showPage(id) {
  $$(".page").forEach((p) => p.classList.remove("active"));
  $(`#${id}`)?.classList.add("active");
}

export function showSection(sectionId, parent) {
  parent
    .querySelectorAll(".content-section")
    .forEach((s) => s.classList.remove("active"));
  parent
    .querySelectorAll(".nav-item")
    .forEach((n) => n.classList.remove("active"));
  parent.querySelector(`#${sectionId}`)?.classList.add("active");
  parent
    .querySelector(`.nav-item[data-section="${sectionId}"]`)
    ?.classList.add("active");
}

export function formatDate(ts) {
  if (!ts) return "-";
  return new Date(ts).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatTime(ts) {
  if (!ts) return "-";
  return new Date(ts).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function openModal(title, bodyHTML) {
  $("#modal-title").textContent = title;
  $("#modal-body").innerHTML = bodyHTML;
  $("#modal-overlay").classList.add("active");
}

export function closeModal() {
  $("#modal-overlay").classList.remove("active");
}

export function statusBadge(s) {
  s = (s || "").toLowerCase();
  if (s === "present")
    return '<span class="badge badge-present">Present</span>';
  if (s === "late") return '<span class="badge badge-late">Late</span>';
  return '<span class="badge badge-absent">Absent</span>';
}

export function riskBadge(pct) {
  if (pct >= 80) return '<span class="badge badge-safe">Safe</span>';
  if (pct >= 60) return '<span class="badge badge-medium">Medium</span>';
  return '<span class="badge badge-low">At Risk</span>';
}

export function barColor(pct) {
  if (pct >= 80) return "var(--green)";
  if (pct >= 60) return "var(--orange)";
  return "var(--red)";
}

export function generateQrToken() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function escHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

export function renderQrCodeFallback(container, sessionId, token) {
  container.innerHTML = `
    <div style="padding:12px;border:1px solid var(--border);border-radius:12px;background:var(--bg);max-width:320px;margin:0 auto;">
      <p style="font-size:12px;color:var(--text-secondary);margin-bottom:8px;">QR unavailable. Use this fallback code:</p>
      <p style="font-family:monospace;font-size:13px;word-break:break-all;color:var(--text);">${escHtml(
        JSON.stringify({ sessionId, token }),
      )}</p>
    </div>
  `;
}
