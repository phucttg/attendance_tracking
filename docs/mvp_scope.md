# MVP Scope — Attendance Web App (MERN) (v2.8)

## Goal
Build a simple internal attendance MVP for an SME. Beginner-friendly but correct logic and extensible.

## In-scope (MVP Features)

### 1) Authentication
- Login with Email/Username + Password
- Backend returns JWT
- Frontend uses JWT for protected APIs
- Profile via /auth/me

### 2) Attendance (Check-in / Check-out)
- EMPLOYEE / MANAGER / ADMIN can check-in and check-out
- 1 attendance record per user per day (unique userId + dateKey)
- Workday late evaluation is based on the registered `scheduleType`, not a single global `08:30` rule
- Supported schedule types:
  - `SHIFT_1` and `SHIFT_2` use schedule-specific grace and late thresholds
  - `FLEXIBLE` does not produce `lateMinutes`
- When schedule enforcement is active, users must register a valid schedule before check-in
  - Missing valid schedule may surface as `UNREGISTERED` and block check-in
- Dashboard shows today's state:
  - Not checked-in yet
  - WORKING (checked-in, not checked-out)
  - Checked-out (day completed)

### 3) My Attendance History
- View monthly attendance history (month filter YYYY-MM)
- Columns:
  - date, checkIn, checkOut, status (computed)
  - lateMinutes, workMinutes, otMinutes

### 4) Requests (Attendance Adjustment)
- Employee creates a request if they forgot or entered wrong time
- Manager/Admin approves or rejects
- On approval: backend updates attendance based on requested times

### 5) Timesheet Matrix
- Monthly matrix view:
  - Manager: team scope
  - Admin: team scope or company scope
- Cells show computed status + color key

### Dashboard Cross-Midnight Approved OT Checkout (NEW v2.8)

**Context:** When a user has an open session from the previous day AND that session has `otApproved=true`, the Dashboard on the next day must display a **Check-out** button instead of Check-in.

**Implementation (Option 1A + 2A):**
- **Data Source (1A):** Uses existing `GET /attendance/open-session` endpoint. Validates `otApproved` via `GET /attendance/me` for the open session's date. If month boundary is crossed, fetches the additional month.
- **Post-Checkout State (2A):** After successful cross-midnight checkout, the main status resets to `Chưa check-in` for the new day. A success feedback alert displays: `Đã check-out ca OT ngày trước`.
- No backend/API/schema changes required.

**Key Logic:**
- `effectiveAttendance`: Derived state that either points to today's attendance (normal flow) or the previous day's open session (cross-midnight approved OT).
- `attendanceSource`: Flag (`CROSS_MIDNIGHT_APPROVED_OT` | normal) to drive conditional UI and success messaging.
- Fail-safe: If `open-session` or cross-month fetch fails, falls back to existing behavior silently.

**Scope Exclusions:**
- OT not approved (`otApproved=false`): No change — behaves as before.
- No retroactive OT approval via Dashboard.
- No backend rule changes for check-in/check-out.

### 6) Monthly Report + Excel Export (ENHANCED v2.7)

#### Basic Features
- Monthly report scope:
  - Manager: team
  - Admin: company or team
- Export to Excel (.xlsx)

#### Report Metrics (NEW v2.7)
Per-employee monthly aggregation:
- **Attendance Summary:**
  - Total workdays in month
  - Days present, days absent
  - Late count, total late minutes
  - Early leave count
- **Leave Breakdown:**
  - Annual leave days, sick leave days, unpaid leave days
- **Work Hours:**
  - Total work hours
  - Approved OT hours
  - Unapproved OT minutes (worked without approval)

#### Excel Export Structure (NEW v2.7)
**Two Sheets:**

1. **Summary Sheet:**
   - Employee roster with aggregated metrics
   - Columns: Employee Code, Name, Team, Workdays, Present, Absent, Late Count/Minutes, Early Leave, Work Hours, OT Hours, Leave Days (Annual/Sick/Unpaid)

2. **Daily Detail Matrix:**
   - Rows: Employees
   - Columns: Each day of the month
   - Cell values: Status codes (ON_TIME, LATE, LEAVE, ABSENT, etc.)
   - Color-coded for visual scanning

#### Security & Quality (NEW v2.7)
- **Formula Injection Prevention:**
  - `sanitizeForExcel()` escapes leading `=`, `+`, `-`, `@` characters
  - OWASP compliance for CSV/Excel injection
- **Secure Download:**
  - Client uses Blob API (no `window.open` XSS risk)
  - `downloadBlob()` utility creates temporary `<a>` element
  - Auto-cleanup after download trigger

#### API Endpoints
- `GET /api/reports/monthly?month=YYYY-MM&scope=team|company&teamId=`
  - Returns JSON report data
- `GET /api/reports/monthly/export?month=YYYY-MM&scope=team|company&teamId=`
  - Returns Excel file (.xlsx)
  - Content-Type: `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
  - Content-Disposition: `attachment; filename="monthly-report-YYYY-MM.xlsx"`

### 7) Admin Basic Management
- Admin creates users
- Admin creates holidays

### 8) Member Management (NEW v2.2)
Admin:
- View today activity of employees (today only):
  - check-in/out times + computed status
- Filter by team or company scope
- Update member account fields (whitelist):
  - name, email, username, startDate, teamId, isActive
- Reset member password (admin manually inputs new password)
- View own profile (via /auth/me)

Manager:
- View today activity of members in the same team (today only)
- View member detail (profile fields)
- View member monthly attendance history (same-team only)

### 9) Enhancements (v2.3)

#### Quick Wins
- **E) Role-based Redirect**: ADMIN → `/admin/members`, MANAGER → `/team/members`
- **C) LATE_AND_EARLY Status**: Combined status when both late and early leave
- **D) Holiday Range**: Create multiple holidays from date range

#### Medium
- **A) Pagination**: Admin user list with page/limit/search
- **B) Soft Delete**: 15-day grace period before purge (configurable)

#### Complex (Needs Design)
- **F) Leave Request**: New request type with date range ✅ DONE
- **G) Cross-midnight OT**: Checkout on next day for overnight shifts ✅ DONE

### 10) OT Request System (NEW v2.6)

#### OT Approval Workflow
- OT is now **approval-based**, not automatic (STRICT mode)
- Employee creates `OT_REQUEST` before checkout
- Manager/Admin approves → OT calculated on checkout
- No approval → workMinutes capped at the schedule-derived shift end, otMinutes = 0
- On fixed-shift workdays, OT thresholds are schedule-derived from the effective schedule
  - `SHIFT_1` => OT starts at `17:30`
  - `SHIFT_2` => OT starts at `18:30`
- Weekend/holiday exception remains unchanged:
  - all work time counts as OT
  - no OT request is required for weekend/holiday OT

#### OT Request Features
- **OT_REQUEST type**: Third request type alongside ADJUST_TIME and LEAVE
- **STRICT mode (A1)**: Without approval, work is capped at the schedule-derived shift end and OT = 0
- **No retroactive requests (E2)**: date >= today required
- **Same-day time check**: estimatedEndTime must be in the future
- **Auto-extend (D2)**: Updating existing PENDING request for same date
- **Quota (D1)**: Max 31 pending OT requests per month per user
- **Minimum duration (B1)**: OT must be ≥ 30 minutes beyond the schedule-derived OT threshold
- **Weekend/holiday exception (F1)**: No OT_REQUEST needed for weekend/holiday OT
- **Cross-midnight OT (I1)**: 1 request, allows next-day end time in 00:00-07:59 (GMT+7)
- **Cancellation (C2)**: DELETE /api/requests/:id (owner, PENDING only, deletes record)
- **Check-in integration**: otApproved auto-set on check-in if approved OT exists
- **Reporting (H2)**: Three OT metrics: totalOtMinutes, approvedOtMinutes, unapprovedOtMinutes

### 11) Audit & Admin Tools (UPDATED v2.7)

#### Auto-Close Scheduler (NEW v2.7)
**Purpose:** Automatically close stale attendance sessions left open overnight.

**How it works:**
- Runs at midnight (00:00 GMT+7) every day
- Finds all sessions with `checkOutAt = null` from dates before today
- Auto-closes each session:
  - Sets `checkOutAt` to midnight of next day after check-in
  - Sets `closeSource = 'SYSTEM_AUTO_MIDNIGHT'`
  - Sets `needsReconciliation = true`
  - Creates AuditLog entry (type: STALE_OPEN_SESSION)
- **Catch-up on restart:** Processes missed days if server was offline

**Configuration:**
- `CHECKOUT_GRACE_HOURS` (1-48, default 24): Max time from check-in to auto-close
- `ADJUST_REQUEST_MAX_DAYS` (1-30, default 7): Submission window for FORGOT_CHECKOUT requests

**Employee Endpoint:**
- `GET /api/attendance/open-session`
  - Returns own open sessions + reconciliation items
  - Includes submission deadlines, overdue flags
  - Used by dashboard to prompt FORGOT_CHECKOUT submissions

#### FORGOT_CHECKOUT Workflow (NEW v2.7)
**Purpose:** Allow employees to reconcile sessions auto-closed at midnight with actual checkout time.

**Request Type:** `ADJUST_TIME` with `adjustMode = 'FORGOT_CHECKOUT'`

**Required Fields:**
- `targetAttendanceId`: ObjectId of auto-closed attendance
- `requestedCheckOutAt`: Actual checkout time
- `date`: Must match target attendance date
- `reason`: Explanation

**Validation:**
- Target must have `closeSource = 'SYSTEM_AUTO_MIDNIGHT'`
- Target must have `needsReconciliation = true`
- Cannot change check-in time (only checkout)
- Must be submitted within `ADJUST_REQUEST_MAX_DAYS` (default 7 days)

**Approval Flow:**
1. Manager/Admin approves request
2. System validates target still needs reconciliation
3. If already reconciled → auto-reject with reason `SESSION_ALREADY_RECONCILED`
4. If valid → update attendance:
   - Set `checkOutAt` to requested time
   - Set `closeSource = 'ADJUST_APPROVAL'`
   - Set `closedByRequestId` to request ID
   - Set `needsReconciliation = false`
5. Work hours recalculated with actual time

**Special Rules:**
- Bypasses weekend/holiday restriction (original check-in was legitimate)
- Only one FORGOT_CHECKOUT per attendance session
- Rejection locks the auto-close time (becomes permanent)

#### Admin Queue & Monitoring (NEW v2.7)
**Endpoint:** `GET /api/admin/attendance/open-sessions?status=all|open|reconciliation`

**Purpose:** Dashboard for admins to monitor stale sessions company-wide.

**Enriched Data:**
- `queueStatus`: OPEN, PENDING_RECONCILIATION, ESCALATED, CLOSED
- `submitDeadline`: When employee must act by
- `isOverdue`: Deadline passed, no request submitted
- `isEscalated`: Pending request older than 4 hours (manager not responding)
- `pendingRequestId`: Link to FORGOT_CHECKOUT request if exists
- `hoursUntilDeadline`: Time remaining for action

**Queue Status Logic:**
- **OPEN:** Session has `checkOutAt = null` (still working or forgot to check out today)
- **PENDING_RECONCILIATION:** Auto-closed, awaiting employee request
- **ESCALATED:** Employee submitted FORGOT_CHECKOUT but manager hasn't acted in 4+ hours
- **CLOSED:** Normal session, no issues

**Summary Counts:**
- Total open sessions
- Total needing reconciliation
- Escalated count (manager bottleneck)
- Overdue count (employee missed deadline)

#### AuditLog System
- **AuditLog system**: Tracks `MULTIPLE_ACTIVE_SESSIONS` and `STALE_OPEN_SESSION` events
  - 90-day TTL auto-cleanup via MongoDB TTL index
  - Pre-save validation ensures data integrity

#### Admin Force Checkout
- **Force Checkout**: Admin endpoint `POST /api/admin/attendance/:id/force-checkout`
  - Manually close any session with custom checkout time
  - Sets `closeSource = 'ADMIN_FORCE'`
  - Sets `needsReconciliation = false`
  - Requires reason field for audit trail
  - Use cases: employee on leave, verbal confirmation from manager, deadline passed

#### Attendance Reconciliation Fields
New fields added to Attendance model (v2.7):
- `closeSource`: enum [USER_CHECKOUT, SYSTEM_AUTO_MIDNIGHT, ADJUST_APPROVAL, ADMIN_FORCE]
- `closedByRequestId`: ObjectId linking to approval request
- `needsReconciliation`: Boolean flag for pending employee action

#### Grace Configuration
- **Grace Config**: Environment variable-based configuration
  - `CHECKOUT_GRACE_HOURS` (1-48, default 24): Max time from check-in to checkout
  - `ADJUST_REQUEST_MAX_DAYS` (1-30, default 7): Submission window for adjust requests

#### Cross-Midnight ADJUST_TIME
- **Cross-midnight ADJUST_TIME**: Requests spanning midnight boundaries
  - Uses `checkInDate`/`checkOutDate` fields for date boundary detection

## Out-of-scope (NOT in MVP)
- Anti-fraud: GPS/QR/device/IP restriction
- Realtime notifications (WebSocket)
- Complex shifts / multiple shift types
- Break tracking
- Payroll/salary and complex OT payment rules
- Import employees from Excel/HR systems

## Performance & Security Notes (v2.7)

### Query Optimization
- **Requests**: Use `.select()` + `.lean()` for lightweight queries when checking existing attendance
- **Attendance Update**: Use `.exists()` instead of `findOne()` when only checking for document existence (faster, returns boolean)
- **Race Conditions**: Partial unique index `{ userId, date, type }` with `status: PENDING` filter prevents duplicate pending requests at DB level. Service layer catches E11000 error and maps to 409 Conflict.

### Pagination
- All paginated endpoints follow pattern: `parsePaginationParams → count → clamp → find → buildPaginatedResponse`
- Endpoints: `/admin/users`, `/requests/me`, `/requests/pending`, `/attendance/today` (v2.5)

### OT Request Optimization (v2.6)
- **Partial unique indexes**: Prevent duplicate PENDING requests at DB level (race condition protection)
- **Auto-extend**: findOneAndUpdate for atomic upsert instead of check-then-insert
- **Pre-validate hooks**: Model-level cross-contamination cleanup prevents data pollution between request types
- **Admin route RBAC**: Currently enforced at controller level (defense-in-depth), not at route middleware level

### Auto-Close & Reconciliation Optimization (NEW v2.7)
- **Partial index for open sessions**: `(userId, checkInAt DESC) WHERE checkOutAt IS NULL`
  - Enables fast lookup of user's active session
  - Used by auto-close scheduler to find stale sessions
- **Compound index for reconciliation queue**: `(needsReconciliation, date)`
  - Optimizes admin queue queries
  - Supports filtering by reconciliation status + date range
- **Scheduler efficiency**:
  - Bulk write operations (updateMany) for midnight auto-close
  - Catch-up runs only on startup, not on every request
  - Cron-like scheduling via setTimeout (no external dependencies)

### FORGOT_CHECKOUT Validation (NEW v2.7)
- **Pre-validate hooks**: Enforce `targetAttendanceId` requirement when `adjustMode = 'FORGOT_CHECKOUT'`
- **Approval-time checks**: Re-validate `needsReconciliation` flag to prevent double-reconciliation race conditions
- **Auto-rejection logic**: If session already reconciled, auto-reject request with reason code instead of throwing error

### Excel Export Security (NEW v2.7)
- **Formula injection prevention**: `sanitizeForExcel()` escapes leading `=`, `+`, `-`, `@`
- **Memory management**: Stream-based Excel generation for large reports (ExcelJS library)
- **Client-side security**: Blob API for downloads (no `window.open` XSS risk)
- **Filename sanitization**: Remove special chars from user-controlled inputs

## MVP Definition of Done
- Login works
- Attendance check-in/out logic works correctly
- Status computation matches RULES.md (especially today/future => null)
- Approving a request updates attendance correctly
- Matrix works for selected month
- Excel export works
- Member Management pages work with correct RBAC:
  - Admin company/team, Manager team-only
- Dashboard shows Check-out for cross-midnight approved OT sessions (v2.8)
- Manual tests pass
