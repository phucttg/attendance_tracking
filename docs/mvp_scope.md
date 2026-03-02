# MVP Scope — Attendance Web App (MERN) (v2.6)

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

### 6) Monthly Report + Excel Export
- Monthly report scope:
  - Manager: team
  - Admin: company or team
- Export to Excel (.xlsx)

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
- No approval → workMinutes capped at 17:30, otMinutes = 0

#### OT Request Features
- **OT_REQUEST type**: Third request type alongside ADJUST_TIME and LEAVE
- **STRICT mode (A1)**: Without approval, work capped at 17:30, OT = 0
- **No retroactive requests (E2)**: date >= today required
- **Same-day time check**: estimatedEndTime must be in the future
- **Auto-extend (D2)**: Updating existing PENDING request for same date
- **Quota (D1)**: Max 31 pending OT requests per month per user
- **Minimum duration (B1)**: OT must be ≥ 30 minutes (estimatedEndTime ≥ 18:01)
- **Weekend/holiday exception (F1)**: No OT_REQUEST needed for weekend/holiday OT
- **Cross-midnight OT (I1)**: 1 request, allows next-day end time in 00:00-07:59 (GMT+7)
- **Cancellation (C2)**: DELETE /api/requests/:id (owner, PENDING only, deletes record)
- **Check-in integration**: otApproved auto-set on check-in if approved OT exists
- **Reporting (H2)**: Three OT metrics: totalOtMinutes, approvedOtMinutes, unapprovedOtMinutes

### 11) Audit & Admin Tools (NEW v2.6)

- **AuditLog system**: Tracks `MULTIPLE_ACTIVE_SESSIONS` and `STALE_OPEN_SESSION` events
  - 90-day TTL auto-cleanup via MongoDB TTL index
  - Pre-save validation ensures data integrity
- **Force Checkout**: Admin endpoint `POST /api/admin/attendance/:id/force-checkout`
  - Closes stale open sessions detected by the system
- **Grace Config**: Environment variable-based configuration
  - `CHECKOUT_GRACE_HOURS` (1-48, default 24): Max time from check-in to checkout
  - `ADJUST_REQUEST_MAX_DAYS` (1-30, default 7): Submission window for adjust requests
- **Cross-midnight ADJUST_TIME**: Requests spanning midnight boundaries
  - Uses `checkInDate`/`checkOutDate` fields for date boundary detection

## Out-of-scope (NOT in MVP)
- Anti-fraud: GPS/QR/device/IP restriction
- Realtime notifications (WebSocket)
- Complex shifts / multiple shift types
- Break tracking
- Payroll/salary and complex OT payment rules
- Import employees from Excel/HR systems

## Performance & Security Notes (v2.6)

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

## MVP Definition of Done
- Login works
- Attendance check-in/out logic works correctly
- Status computation matches RULES.md (especially today/future => null)
- Approving a request updates attendance correctly
- Matrix works for selected month
- Excel export works
- Member Management pages work with correct RBAC:
  - Admin company/team, Manager team-only
- Manual tests pass
