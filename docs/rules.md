# Rules — Attendance Logic (v2.6)

Timezone: Asia/Ho_Chi_Minh (GMT+7)  
All dateKey calculations MUST use GMT+7.

## 0) Doc Priority (Conflict Resolution)
If docs conflict, resolve in this order:
1) RULES.md (this file) — logic truth
2) API_SPEC.md — endpoint shapes/behavior
3) DATA_DICTIONARY.md — DB fields/types/indexes

## 1) Workday Configuration (MVP)
- Work start: 08:30
- Work end: 17:30
- Grace: 15 minutes
  - Late starts at 08:46
- Lunch break: 60 minutes
  - Deduct lunch if a work span crosses 12:00–13:00
- OT starts after 17:31

## 2) Attendance Record Rules
- One attendance record per user per day:
  - Unique constraint: (userId + dateKey)
- No "ABSENT attendance record":
  - If user is absent, there is typically NO attendance record for that day.

Fields:
- checkInAt: required once checked in
- checkOutAt: may be null (still working or missing checkout)

## 3) Status Computation Rules (Core)
Given a dateKey and optional attendance record:

### 3.1 Weekend/Holiday
- If dateKey is weekend OR in holidays => status = WEEKEND_OR_HOLIDAY
  - This applies whether attendance exists or not (but if you allow working on holiday, you may still show checkIn/out times)

### 3.2 Today vs Future vs Past
Let "todayKey" = current date in GMT+7.

- If dateKey > todayKey (future):
  - status = null (always)
- If dateKey == todayKey (today):
  - If no attendance record => status = null (NOT ABSENT)
  - If checkInAt exists and checkOutAt is null => WORKING
  - If checkInAt and checkOutAt exist:
    - Determine late vs on time
- If dateKey < todayKey (past):
  - If no attendance record => ABSENT
  - If checkInAt exists and checkOutAt is null => MISSING_CHECKOUT
  - If checkInAt and checkOutAt exist:
    - Determine late vs on time

### 3.3 Late vs On-time vs Early Leave
Applies ONLY when both checkInAt AND checkOutAt exist (day complete):
- "On time" if checkInAt time <= 08:45 (GMT+7 local time)
- "Late" if checkInAt time >= 08:46
- "Early leave" if checkOutAt < 17:30 (GMT+7)

Status priority (current implementation):
1. LATE_AND_EARLY (NEW v2.3: if late AND early leave) — highest severity
2. LATE (if >= 08:46 but not early leave)
3. EARLY_LEAVE (if on time but left early)
4. ON_TIME (if on time and full day)

### 3.4 Missing Checkout
- Past date with checkInAt exists but checkOutAt is null => MISSING_CHECKOUT

### 3.5 Working (today)
- Today with checkInAt exists but checkOutAt is null => WORKING

### 3.6 Missing Check-in (NEW v2.6)
- checkOutAt exists but checkInAt is null => MISSING_CHECKIN
- This is an edge case (data corruption or manual entry error)

### 3.7 Unknown (NEW v2.6)
- Returned for invalid/corrupted data scenarios:
  - null or undefined attendance record
  - Empty or invalid dateKey
  - checkOutAt < checkInAt (reversed timestamps)
- Acts as a fail-safe to prevent misclassification

## 4) Minutes Computation
### 4.1 lateMinutes
If status is LATE or WORKING (late so far):
- lateMinutes = max(0, checkInAt - 08:45)
Else 0.

### 4.2 workMinutes
If checkInAt exists:
- If checkOutAt exists:
  - raw = checkOutAt - checkInAt
  - If span crosses 12:00–13:00 => deduct 60 minutes
  - workMinutes = max(0, raw - lunchDeduct)
- If checkOutAt is null:
  - workMinutes may be 0 or computed "so far" depending on UI needs
  - For MVP reports, prefer computed only when checkOutAt exists
Else 0.

### 4.3 otMinutes
If checkOutAt exists:
- If checkOutAt time > 17:31:
  - otMinutes = minutes between 17:31 and checkOutAt (excluding lunch already handled in workMinutes if needed)
Else 0.

## 5) Requests Adjustment Rules
Requests must be on the same dateKey (GMT+7) as the request.date.
- requestedCheckInAt and/or requestedCheckOutAt must belong to that dateKey
- If both exist, out > in

On approve:
- Update or create attendance record for that dateKey
- Apply requested times (set checkInAt/checkOutAt)

## 6) Timesheet Matrix Rules
- Matrix cell status uses the same computed status rules above.
- colorKey is derived from status:
  - WEEKEND_OR_HOLIDAY => grey
  - ON_TIME => green
  - LATE => orange/red
  - EARLY_LEAVE => yellow
  - LATE_AND_EARLY => purple (NEW v2.3)
  - WORKING => blue
  - MISSING_CHECKOUT => yellow (darker)
  - MISSING_CHECKIN => red (darker) (NEW v2.6)
  - ABSENT => grey (lighter shade, distinct from weekend)
  - LEAVE => cyan (NEW v2.3)
  - UNKNOWN => grey (dashed border) (NEW v2.6)
  - null => empty/neutral

## 7) Member Management Rules (NEW v2.2)
### 7.1 "Today Activity" View
- "Today activity" always refers to todayKey in GMT+7.
- If an employee has no attendance record today:
  - status must be null (NOT ABSENT)

### 7.4 Pagination Rules (NEW v2.5)
- Default limit: 20, max limit: 100
- Paginated endpoints: `/admin/users`, `/requests/me`, `/requests/pending`, `/attendance/today`
- Pattern: count total → clamp page → skip/limit
- Response format: `{ items, pagination: { page, limit, total, totalPages } }`
- Clamping: if requested page > totalPages, return last page with items

### 7.2 Scope & RBAC
- ADMIN:
  - can view company scope OR filter by team
  - can update basic member fields (whitelist)
  - can reset password (admin enters new password)
- MANAGER:
  - can only view members in the same team
  - can view member detail + monthly attendance of same-team only
- Anti-IDOR is mandatory on any endpoint that accepts userId:
  - Manager must be blocked from accessing other-team users (403).

### 7.3 Soft Delete Implementation (NEW v2.3)
- Query pattern: `{ deletedAt: null }` (requires one-time migration)
- Migration script (run once):
  ```js
  db.users.updateMany(
    { deletedAt: { $exists: false } },
    { $set: { deletedAt: null } }
  );
  ```
- Purge job: Cascade delete attendances + requests when purging users:
  ```js
  const userIds = usersToDelete.map(u => u._id);
  await Attendance.deleteMany({ userId: { $in: userIds } });
  await Request.deleteMany({ userId: { $in: userIds } });
  await User.deleteMany({ _id: { $in: userIds } });
  ```

## 8) Leave Request Rules (NEW v2.3)
### 8.1 Leave Request Type
- Request can be type `ADJUST_TIME` or `LEAVE`
- LEAVE = full-day leave only (no attendance for that day)
- LEAVE request requires: leaveStartDate, leaveEndDate (YYYY-MM-DD)
- Optional: leaveType (ANNUAL | SICK | UNPAID)

### 8.2 Leave vs Attendance
- LEAVE is for days with **no attendance**
- If attendance already exists for a date:
  - Block LEAVE request => 400 "Already checked in for date X, use ADJUST_TIME instead"
- To request early leave (already checked in): use ADJUST_TIME with requestedCheckOutAt

### 8.3 Leave Status Priority
- Priority order (highest to lowest):
  1. WEEKEND_OR_HOLIDAY (always shows for weekends/holidays)
  2. LEAVE (if approved leave exists for workday)
  3. ABSENT (workday with no attendance and no leave)

### 8.4 Leave Spanning Weekends
- Leave CAN span weekends (e.g., Mon to next Mon)
- Status per day in range:
  - Weekend/holiday => WEEKEND_OR_HOLIDAY (not LEAVE)
  - Workday => LEAVE
- Leave days count = workdays only (exclude weekends/holidays)

### 8.5 Leave in Reports
- Leave days count separately from absent days
- Leave days should NOT count as late

### 8.6 Leave Implementation (Design Decision)
- Storage: Query `requests` collection (no fake attendance records)
- Status compute: Caller must fetch approved leaves and pass `leaveDates: Set<string>` to compute function
- Signature: `computeAttendance(record, holidayDates, leaveDates = new Set())`

## 9) Cross-midnight OT Rules (NEW v2.3 - PLANNED)
### 9.1 Definition
- Cross-midnight: checkOutAt is on the next calendar day (GMT+7)
- Example: checkIn 2026-01-23 08:00, checkOut 2026-01-24 02:00

### 9.2 Checkout Logic
- Find active session (checkInAt exists, checkOutAt null) instead of by dateKey
- Allow checkout within 24h of checkIn
- Configurable via env: `CHECKOUT_GRACE_HOURS` (default: 24)

### 9.3 OT Calculation
- OT = minutes from 17:31 to checkOut (even if next day)
- Example: 17:31 to 02:00 next day = 8.5 hours OT

### 9.4 Matrix Display
- Attendance record belongs to check-in date
- Cross-midnight shows "WORKING" until checked out

### 9.5 Month Filter Behavior
- `/attendance/me?month=YYYY-MM` returns records where `date` (check-in date) is in that month
- If checkIn = Jan 31, checkOut = Feb 1:
  - Appears in `month=2026-01` (by check-in date)
  - `checkOutAt` shows Feb 1 ISO as-is
  - Does NOT appear in `month=2026-02`

### 9.6 workMinutes / Lunch for Long Shifts
- workMinutes = checkOutAt - checkInAt
- Lunch: deduct 60 mins ONCE if shift spans 12:00–13:00 on check-in day
- No second lunch deduction for overnight shifts
- No workMinutes cap (MVP): 20h shift => 1140 mins

---

## 10) OT Request Rules (NEW v2.6)

### 10.1 Overview
**Core Change:** OT (overtime) is now **approval-based**, not automatic.

**Old Behavior (v2.5):**
- User checks out after 17:31 → OT automatically calculated
- No request/approval needed

**New Behavior (v2.6):**
- User must create `OT_REQUEST` BEFORE checkout
- Manager/Admin approves → OT calculated
- No approval → workMinutes capped at 17:30, OT = 0

---

### 10.2 OT Request Creation Rules

**Who:** EMPLOYEE | MANAGER | ADMIN (any role can request OT for themselves)

**When:**
- ✅ Must request BEFORE checkout (E2: no retroactive)
- ✅ Can request for today or future dates (E1: advance notice allowed)
- ❌ Cannot request for past dates

**Required Fields:**
- `date`: "YYYY-MM-DD" (today or future)
- `estimatedEndTime`: Date (ISO timestamp)
- `reason`: String (why OT is needed)

**Validation Rules:**

1. **Date Validation:**
   - `date >= todayKey` (no retroactive requests)
   - Must be valid YYYY-MM-DD format

2. **Time Validation:**
   - `estimatedEndTime` must be on same calendar day (GMT+7) as `date`
   - `estimatedEndTime` must be > 17:31 on that date
   - Minimum OT duration: 30 minutes (B1)
     - Calculated as: `estimatedEndTime - 17:31 >= 30 minutes`

3. **State Validation:**
   - Cannot create if user already checked out for that date
   - Error: "Cannot request OT after checkout"

4. **Quota Limits:**
   - Maximum 31 PENDING OT requests per month per user (D1)
   - Month calculated from `date` field

**Auto-Extend Feature (D2):**
- If PENDING OT request exists for same (userId, date):
  - UPDATE existing request instead of creating new one
  - Updates: `estimatedEndTime`, `reason`
  - Keeps same `_id`, `status`, `createdAt`
- Example:
  ```
  Request 1: date=2026-02-05, estimatedEndTime=20:00, status=PENDING
  Request 2: date=2026-02-05, estimatedEndTime=22:00 (same date)
  → Request 1 updated to estimatedEndTime=22:00
  → Only 1 request exists
  ```

---

### 10.3 Cross-Midnight OT (I1)

**Rule:** Cross-midnight OT uses **1 request** anchored by check-in date.

**Definition:**
- `date` remains the check-in date.
- `estimatedEndTime` may be:
  - same day as `date`, or
  - immediate next day (`date + 1`) only when time is in `00:00-07:59` (GMT+7).

**Example:**
```
Shift: 2026-02-05 08:30 → 2026-02-06 02:00

Request:
OT_REQUEST: date=2026-02-05, estimatedEndTime=2026-02-06T02:00:00+07:00

Result:
- Attendance (2/5): otApproved=true
- OT duration calculated from 17:31 (2/5) to 02:00 (2/6)
```

**Validation:**
- Reject if `estimatedEndTime` is not on `date` or `date + 1`.
- If `estimatedEndTime` is on `date + 1`, reject when time is `>= 08:00`.

---

### 10.3.1 OT Request Timing Policy (STRICT) 🚫

**Core Principle:** OT must be requested **BEFORE** the overtime work begins

**Policy Details:**
- ✅ **Future requests allowed:** Can request OT for today (future time) or any future date
- ❌ **Retroactive requests blocked:** Cannot request OT for time that has already passed
- ⏰ **Same-day rule:** For today's date, `estimatedEndTime` must be in the future

**Implementation (P1-2 Fix):**
```javascript
// Validation runs AFTER past date check, BEFORE OT period check
if (date === todayKey) {
  const now = Date.now();
  if (estimatedEndTime <= now) {
    throw Error('Cannot create OT request for past time');
  }
}
```

**Examples:**

| Current Time | Request Date | Estimated End Time | Result | Reason |
|--------------|--------------|-------------------|--------|---------|
| 16:00 | Today | 19:00 | ✅ ALLOW | Future time |
| 23:00 | Today | 18:00 | ❌ REJECT | Past time (5 hours ago) |
| 23:00 | Today | 23:00 | ❌ REJECT | Current time (not future) |
| 23:00 | Today | 23:30 | ✅ ALLOW | Future time (30 min ahead) |
| 10:00 | Tomorrow | 19:00 | ✅ ALLOW | Future date (any time OK) |
| 10:00 | Yesterday | 19:00 | ❌ REJECT | Past date |

**Rationale:**
1. **Data Integrity:** Prevent retroactive OT recording abuse
2. **Manager Approval:** Managers must approve OT **before** overtime work
3. **Audit Trail:** Clear timestamp showing OT was planned, not fabricated
4. **Fair Process:** All employees follow same "request first" rule

**Exception Handling:**
- If employee forgot to request: Contact manager for manual adjustment
- Emergency OT: Manager can create ADJUST_TIME request after the fact (admin override)
- System downtime: Manager can approve retroactive requests case-by-case

**Error Message:**
```
Cannot create OT request for past time.
OT must be requested before the estimated end time.
Current time: 2/10/2026, 11:00:00 PM (GMT+7)
Requested time: 2/10/2026, 6:00:00 PM (GMT+7)
If you forgot to request, please contact your manager.
```

**Business Impact:**
- Reduces OT fraud risk
- Improves planning and resource allocation
- Maintains clear audit trail for compliance
- Enforces proactive communication between employees and managers

---

### 10.4 OT Approval Workflow

**Who Can Approve:**
- **MANAGER:** Can approve OT requests from users in same team only (RBAC)
- **ADMIN:** Can approve any OT request company-wide

**Approval Effect:**
```javascript
// When OT_REQUEST approved:
attendance.otApproved = true  // for that date

// If attendance doesn't exist yet (user not checked in):
// - Flag stored in Request record
// - Applied automatically on check-in
```

**State Transitions:**
```
PENDING → APPROVED (manager/admin action)
PENDING → REJECTED (manager/admin action)
PENDING → DELETED (employee cancels via DELETE /api/requests/:id)
```

> **Note:** Cancellation deletes the request from the database entirely.
> There is no `CANCELLED` status in the enum. See §10.7 for details.

**No Rejection Reason Required (G2):**
- Rejection doesn't require explanation
- But recommended to communicate separately

---

### 10.5 OT Calculation Rules (STRICT - A1)

**Core Rule:** OT only calculated if `attendance.otApproved = true`

#### Scenario A: WITH OT Approval ✅
```
date: 2026-02-05
checkInAt: 08:30
checkOutAt: 20:00
otApproved: true

Calculation:
- workMinutes = 08:30 to 17:30 = 480 minutes (minus lunch 60)
- otMinutes = 17:31 to 20:00 = 149 minutes
- Total working time = 480 + 149 = 629 minutes
```

#### Scenario B: WITHOUT OT Approval ❌
```
date: 2026-02-05
checkInAt: 08:30
checkOutAt: 20:00
otApproved: false

Calculation:
- workMinutes = 08:30 to 17:30 = 480 minutes (CAPPED at 17:30)
- otMinutes = 0 (no approval)
- Time 17:30-20:00: LOST (not counted, not paid)
- Total working time = 480 minutes only
```

**Implementation:**
```javascript
// In computeWorkMinutes()
if (!otApproved) {
  const endOfShift = createTimeInGMT7(dateKey, 17, 30);
  effectiveCheckOut = min(checkOutAt, endOfShift);
  // Work capped at 17:30
}

// In computeOtMinutes()
if (!otApproved) {
  return 0;  // No OT without approval
}
```

**Key Points:**
- A1 (STRICT): No grace period - về sau 17:30 phải có approval
- B2: Actual OT = calculated at checkout (not estimated time from request)
- C1: Automatic calculation based on actual checkout time

---

### 10.6 Weekend/Holiday Exception (F1)

**Special Case:** Weekend/holiday OT does NOT require OT_REQUEST.

**Rationale:**
- Working on weekend/holiday = exceptional case
- Usually pre-planned and manager-aware
- Simplified workflow for special circumstances

**Behavior:**
```javascript
// Weekend/Holiday logic (unchanged from v2.5)
if (isWeekend(dateKey) || holidayDates.has(dateKey)) {
  // Force otApproved=true for calculation purposes
  workMinutes = computeWorkMinutes(dateKey, checkIn, checkOut, true);
  otMinutes = computeOtMinutes(dateKey, checkOut, true);
  // No OT_REQUEST needed
}
```

**This applies to:**
- Saturday/Sunday
- Public holidays (from Holiday model)
- Company-specific holidays

---

### 10.7 OT Cancellation Rules (C2)

**Who Can Cancel:**
- Request owner (userId match) only
- Cannot cancel others' requests

**When Can Cancel:**
- Status = PENDING only
- Cannot cancel APPROVED or REJECTED requests

**Effect:**
- Request deleted from database
- If `otApproved` already set on attendance:
  - Flag remains (doesn't auto-revert)
  - Admin must manually adjust if needed

**Endpoint:**
```
DELETE /api/requests/:id
- Returns 200 if successful
- Returns 404 if not found or already processed
```

---

### 10.8 Check-In Integration

**Automatic otApproved Detection:**

When user checks in, system checks for approved OT request:
```javascript
// In checkIn()
const approvedOtRequest = await Request.findOne({
  userId,
  type: 'OT_REQUEST',
  date: todayKey,
  status: 'APPROVED'
});

if (approvedOtRequest) {
  attendance.otApproved = true;  // Auto-set on check-in
}
```

**Scenarios:**

1. **Request → Approve → Check-In:**
   - OT request created & approved
   - User checks in later
   - `otApproved` set automatically ✅

2. **Check-In → Request → Approve:**
   - User checks in first
   - Creates OT request
   - Manager approves
   - `otApproved` updated on attendance record ✅

3. **No Request:**
   - User checks in
   - No OT request exists
   - `otApproved` remains false
   - Checkout capped at 17:30 ❌

---

### 10.9 Reporting Metrics (H2)

**Monthly Report Enhancement:**

Users now have 3 OT metrics:

1. **totalOtMinutes:** All approved OT worked (paid OT)
2. **approvedOtMinutes:** Same as total (for clarity)
3. **unapprovedOtMinutes:** Time worked after 17:30 WITHOUT approval

**Calculation:**
```javascript
for (const record of records) {
  if (record.otApproved) {
    approvedOtMinutes += computeOtMinutes(record.date, record.checkOutAt, true);
  } else {
    // Calculate potential OT (what would have been)
    if (record.checkOutAt > endOfShift) {
      unapprovedOtMinutes += computePotentialOtMinutes(record.date, record.checkOutAt);
    }
  }
}
```

**Purpose:**
- Track compliance (unapproved OT = potential policy violation)
- Visibility for managers
- Audit trail for HR

**Example Report:**
```json
{
  "userId": "123",
  "name": "John Doe",
  "totalOtMinutes": 450,        // Approved OT (paid)
  "approvedOtMinutes": 450,     // Same as total
  "unapprovedOtMinutes": 120    // Worked without approval (not paid)
}
```

---

### 10.10 Validation Summary Table

| Rule | Field | Validation | Error Message |
|------|-------|------------|---------------|
| E2 | date | >= todayKey | "Cannot create OT request for past dates" |
| I1 | estimatedEndTime | same calendar day as date | "Cross-midnight OT requires separate requests" |
| - | estimatedEndTime | > 17:31 | "OT must start after 17:31" |
| B1 | estimatedEndTime | >= 17:31 + 30 mins | "Minimum OT duration is 30 minutes" |
| E2 | checkout | must not exist | "Cannot request OT after checkout" |
| D1 | quota | < 31 pending/month | "Maximum 31 pending OT requests per month" |

---

### 10.11 Edge Cases & FAQs

**Q: User works 17:30-18:30 without OT request. What happens?**
- Work capped at 17:30
- 17:30-18:30 time is LOST (not counted)
- User should have requested OT beforehand

**Q: OT request approved but user leaves at 18:00?**
- OT calculated 17:31-18:00 = 29 minutes (less than minimum but still counted)
- Request status remains APPROVED (no automatic update)

**Q: Can request OT for next week?**
- Yes (E1: advance notice allowed)
- Common for planned deployments, projects

**Q: What if 32nd OT request in a month?**
- Error 400: "Maximum 31 pending OT requests per month reached"
- Must wait for approval/rejection of existing requests

**Q: Can admin force-set otApproved without request?**
- No - must have OT_REQUEST record for audit trail
- Ensures all OT is documented and approved

**Q: User forgets to request OT, can request after checkout?**
- No (E2: no retroactive requests)
- Must be handled as exception by HR/manager manually

---

### 10.12 Priority & Conflict Resolution

**Document Hierarchy:**
1. This section (§10) - OT Request Rules (v2.6)
2. Section §4.3 - otMinutes computation (updated for otApproved)
3. Section §9 - Cross-midnight OT (existing rules)

**In Case of Conflict:**
- OT approval requirement (§10.5) OVERRIDES automatic calculation (§4.3)
- Weekend/holiday exception (§10.6) takes precedence over approval requirement
- Cross-midnight rules (§10.3) align with existing §9 structure
