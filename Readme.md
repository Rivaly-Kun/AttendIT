# AttendIT - QR-Based Attendance System with Teacher Approval

## Overview

AttendIT is a modern, real-time attendance management system that uses QR codes for student check-in and implements a teacher approval workflow for enrollment security. The system divides users into two roles: **Instructors** (teachers) who manage attendance and approve student signups, and **Students** who scan QR codes to record their attendance.

The system enforces a **section-based enrollment model** where instructors only manage their own sections, students must be approved before accessing any features, and attendance is tracked in real-time with live monitoring dashboards.

---

## Key Features

### 1. **QR-Based Attendance Scanning**
- Students use their devices to scan a dynamically-generated QR code displayed on a monitor during class
- The QR code contains a secure session token that validates the class session
- Automatic late detection based on configurable thresholds
- Fallback mechanisms: If the primary QR generation service fails, the system automatically cascades through backup providers (QuickChart → QRServer → Google Charts)

### 2. **Teacher Approval Workflow**
- New students register with their Grade and Section but start in a **"pending"** approval state
- Instructors review pending students **scoped only to their own sections** (privacy protection)
- Approval action **auto-enrolls** the student to all matching subjects for that grade/section
- Rejection blocks out-of-scope students from accessing the system
- Both approve and reject actions are section-scoped; instructors cannot manage students outside their purview

### 3. **Live Attendance Monitor**
- Real-time display showing which students have checked in during the current session
- Shows attendance status: Present, Late, Absent
- Automatically updates as students scan their QR codes
- Only displays the active session's attendance data
- Properly cleans up subscriptions when changing sessions or logging out

### 4. **Attendance Reports & Analytics**
- Generate reports filtered by date range, subject (optional), and instructor ownership
- Aggregates attendance records showing:
  - Number of students present, late, and absent per session
  - Per-student attendance history
  - Export to PDF or Excel formats
- **Fixed:** Date filtering now correctly handles local timezone (previously excluded early-morning sessions)

### 5. **Grade/Section Academic Structure**
- System defines valid Grade-Section combinations (e.g., Grade 12 Section A, Grade 11 Section B)
- Subjects are bound to specific grade/section pairs
- Students must select their correct Grade/Section during signup
- Section-based filtering ensures instructors only see their own enrollments

### 6. **Student Dashboard**
- View enrollment status (Pending / Approved / Rejected)
- Access schedule showing all enrolled subjects with timings
- View attendance history across all subjects
- Access QR scanner directly from the dashboard
- Blocked from accessing features if approval status is not "approved"

### 7. **Instructor Dashboard**
- View pending student approvals (filtered to only their sections)
- Approve/reject students with one click
- Create and manage attendance sessions
- Monitor live attendance in real-time
- Generate and export attendance reports

---

## User Roles & Workflows

### Instructor Workflow
1. **Login** → Redirected to instructor dashboard
2. **Approve pending students** → Reviews pending approvals (only those in instructor's sections) → Approves (auto-enrolls to matching subjects) or Rejects
3. **Create session** → Selects a subject → Generates QR code with session token
4. **Monitor attendance** → Live view of students checking in, updates in real-time
5. **close session** → Finalizes attendance records for the session
6. **View reports** → Filter by date range and subject → Export to PDF/Excel

### Student Workflow
1. **Register** → Provides credentials, selects Grade and Section → Marked as "pending" approval
2. **Wait for approval** → Status shown on dashboard
3. **Approval received** → Auto-enrolled to all subjects in their grade/section → Can now access full app
4. **Scan QR code** → Opens scanner → Points device at displayed QR code → Attendance recorded
5. **View history** → Dashboard shows attendance record (Present / Late / Absent)
6. **Check schedule** → Dashboard lists all enrolled subjects with times and locations

---

## System Architecture

### Tech Stack
- **Frontend:** Vanilla JavaScript (modular architecture), HTML5, CSS3
- **Backend:** Firebase Realtime Database (v11.0.2)
- **Authentication:** Firebase Auth
- **QR Generation:** QuickChart, QRServer, Google Charts APIs (cascading fallbacks)
- **Export:** jsPDF (PDF), XLSX (Excel)
- **QR Scanner:** Html5Qrcode library
- **Icons:** Font Awesome
- **Styling:** CSS variables with modern design patterns

### Module Structure

| Module | Purpose |
|--------|---------|
| **state.js** | Centralized state container; tracks auth, role, QR timers, monitor listener subscriptions |
| **auth.js** | Login, register, logout; auth state listener; forces dashboard on login; clears caches on logout |
| **approvals.js** | Student signup approval workflow; section-scoped approval/rejection; auto-enrollment |
| **student.js** | Student dashboard, schedule, history, QR scanner; approval state display |
| **sessions.js** | Session creation, QR rotation (30s cycle), live monitor, cleanup on section exit |
| **reports.js** | Date-filtered attendance aggregation; PDF/Excel export; timezone-aware date parsing |
| **stats.js** | Refresh UI elements (approval counts, enrollment counts) |
| **helpers.js** | Utility functions (time formatting, badge rendering, UI helpers) |
| **academic.js** | Grade/Section validation, academic structure fetching from Firebase |
| **app.js** | Main entry point, navigation wiring, auth lifecycle |
| **firebase-init.js** | Firebase SDK initialization with credentials |

---

## Database Schema

### `/academicStructure`
Defines valid Grade-Section combinations:
```json
{
  "grades": ["Grade 11", "Grade 12"],
  "sections": ["Section A", "Section B"],
  "gradeSections": {
    "Grade 11": ["Section A", "Section B"],
    "Grade 12": ["Section A", "Section B"]
  }
}
```

### `/users/{uid}`
Student and instructor profiles:
```json
{
  "email": "student@school.com",
  "displayName": "John Doe",
  "role": "student",
  "grade": "Grade 12",
  "section": "Section A",
  "approvalStatus": "pending" // or "approved" or "rejected"
}
```

### `/subjects/{subjectId}`
Courses bound to specific grade/sections:
```json
{
  "name": "Chemistry",
  "code": "CHEM-101",
  "instructorId": "uid_of_teacher",
  "grade": "Grade 12",
  "section": "Section A",
  "scheduleTime": "10:00 AM"
}
```

### `/sessions/{sessionId}`
Active or closed attendance sessions:
```json
{
  "instructorId": "uid_of_teacher",
  "subjectId": "chem_101_g12_a",
  "status": "active", // or "closed"
  "createdAt": 1776018526357,
  "qrToken": "unique_secure_token"
}
```

### `/attendance/{sessionId}/{userId}`
Attendance records per session:
```json
{
  "status": "present", // or "late" or "absent"
  "scannedAt": 1776018600000,
  "markedAt": 1776018600000
}
```

### `/enrollments/{subjectId}/{userId}`
Student-subject relationships:
```json
{
  "enrolledAt": 1776018526357,
  "enrolledByApproval": true // true if auto-enrolled by approval, false if manual
}
```

### `/auditLog`
System events for compliance:
```json
{
  "timestamp": 1776018526357,
  "action": "approve_student",
  "actor": "instructorId",
  "target": "studentId",
  "details": { ... }
}
```

---

## Critical System Workflows

### 1. Student Signup & Approval Flow
```
Student registers
    ↓
Validation: Grade/Section must exist in academicStructure
    ↓
User record created with approvalStatus: "pending"
    ↓
Student dashboard shows "Pending Approval" badge
    ↓
Instructor reviews pending list (filtered to their sections only)
    ↓
Instructor approves or rejects
    ↓
If approved:
  - approvalStatus set to "approved"
  - Auto-enrolled to all subjects matching their grade/section
  - enrolledByApproval flag set to true
    ↓
If rejected:
  - approvalStatus set to "rejected"
  - Student blocked from scanning or accessing features
```

### 2. QR Attendance Scanning
```
Instructor creates session → QR code generated → displayed on monitor
    ↓
Student scans QR code
    ↓
System validates:
  1. Session exists and is active
  2. QR token is valid and fresh (not expired)
  3. Student user exists in database
  4. Student approved (approvalStatus === "approved")
  5. Student enrolled in the subject
  6. Student hasn't already scanned this session (prevents duplicates)
  7. Check late threshold (configurable time limit)
    ↓
Attendance record created with status: "present" or "late"
    ↓
Live monitor updates in real-time showing new student entry
    ↓
At session end, any enrolled student without a record marked as "absent"
```

### 3. Live Monitor Subscription Lifecycle
```
Instructor opens monitor section
    ↓
Monitor auto-selects most recent active session (if one exists)
    ↓
Firebase listener subscribes to attendance records for that session
    ↓
Real-time table updates as students scan
    ↓
If instructor switches sessions:
  - Old subscription unsubscribed (cleanup)
  - New session's listener subscribed
    ↓
If instructor leaves monitor section or logs out:
  - All listeners unsubscribed
  - Monitor UI cleared
  - QR timer stopped
    ↓
This prevents listener stacking and background subscriptions
```

### 4. Report Generation with Date Filtering
```
User selects date range (e.g., 2026-04-13 to 2026-04-14)
    ↓
System converts to local timezone day boundaries:
  - Start: 2026-04-13 00:00:00 local time
  - End: 2026-04-14 23:59:59.999 local time
    ↓
Filter instructor's sessions within time range
    ↓
For each session, fetch attendance records
    ↓
Aggregate statistics by student:
  - Count present, late, absent
  - Show per-session breakdown
    ↓
Fill missing students as "absent" for sessions they didn't scan
    ↓
Export to PDF or Excel with formatting
```

---

## Security Features

### Privacy & Scope
- **Section-scoped approvals:** Instructors can only approve/reject students in their own sections
- **Ownership validation:** Students can only view their own records; instructors only their own sessions
- **Role-based access:** Students cannot access instructor features; instructors cannot scan as students

### Approval Gate
- **Mandatory approval:** All students start as "pending" and must be approved before any system access
- **Auto-enrollment:** Approved students automatically enrolled to matching subjects (transparent and automatic)
- **Rejection blocks access:** Rejected students cannot scan QR or access restricted features

### Data Integrity
- **Duplicate scan prevention:** System checks if student already has attendance record for session
- **Session validation:** QR tokens validated to prevent scanning old/closed sessions
- **Audit logging:** All approval/rejection actions logged (structure in place; can be integrated)

---

## Deployment & Setup

### Prerequisites
- Node.js and npm installed
- Firebase project created and configured
- Credentials added to `firebase-init.js`

### Installation
```bash
npm install firebase
```

### Running the App
1. Open `index.html` in a web browser
2. Register as student or instructor (Firebase will auto-create)
3. **First student:** Will be pending; need another browser (or role) as instructor to approve
4. Instructor approves student → student can now access all features

### Configuration
- **Academic Structure:** Edit academicStructure in Firebase Realtime Database
- **Late threshold:** Set in session creation logic (currently not exposed in UI)
- **Schedule times:** Defined per subject in database

---

## Known Features & Behaviors

### Backward Compatibility
- Existing subject records without grade/section binding are treated as global (accessible to all grades/sections, but may appear in filters unexpectedly)
- Legacy student accounts without `approvalStatus` field treated as "approved" for backward compatibility

### UI/UX
- Left-side navigation for dashboard pages (responsive design)
- Real-time dashboard updates via Firebase listeners
- Modal forms for admin workflows (approval, session creation)
- QR code centered in monitor display for optimal visibility
- Toast notifications for approval status and errors

### Performance
- Listener cleanup prevents memory leaks and background subscriptions
- Session state cleaned on logout to prevent stale data
- QR code cascades through multiple generation services for reliability

