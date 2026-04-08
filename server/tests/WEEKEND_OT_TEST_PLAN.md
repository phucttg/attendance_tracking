# Weekend/Holiday OT — Comprehensive Test Plan

## Test Strategy Overview

**Feature**: Weekend/Holiday OT = Toàn bộ thời gian làm việc  
**Test Design**: ISTQB techniques — Equivalence Partitioning, Boundary Value Analysis, State Transition Testing, Decision Table Testing  
**ISO 25010 Focus**: Functional Suitability (Critical), Reliability (High), Security (Medium), Maintainability (High)  
**Priority**: HIGH  

**Quality Objectives**:
- 100% acceptance criteria coverage  
- >80% line coverage on modified modules  
- Zero regression in existing weekday OT behavior  

---

## Test Files & Structure

| # | File | Type | Scope |
|---|------|------|-------|
| T1 | `attendance-compute-weekend-ot.test.js` | Unit (pure) | `computeWeekendOtMinutes` + `computeAttendance` weekend/holiday branch |
| T2 | `ot-edge-cases.test.js` | Unit + Integration | Weekend assertions within comprehensive edge case suite |
| T3 | `report-weekend-ot-classification.test.js` | Integration (MongoDB) | `getMonthlyReport` OT classification for weekend/holiday |
| T4 | `today-activity-weekend-ot.test.js` | Integration (MongoDB) | `getTodayActivity` weekend metrics via API service |
| T5 | *(new)* `weekend-ot-regression.test.js` | Integration | Weekday OT regression — ensure no behavioral change |

---

## T1: `attendance-compute-weekend-ot.test.js`

### Current Coverage (10 cases implemented)

Already covers basic `computeWeekendOtMinutes` + 1 holiday case.

### Missing Edge Cases to Add

```
describe('computeWeekendOtMinutes')
```

| # | Test Case | Input | Expected | ISTQB Technique | Status |
|---|-----------|-------|----------|-----------------|--------|
| 1.1 | Sunday morning (no lunch span) | Sun 08:00–11:00 | 180 | EP: morning shift | ✅ Exists |
| 1.2 | Saturday full day (spans lunch) | Sat 08:00–17:00 | 480 | EP: full day | ✅ Exists |
| 1.3 | Partial morning | Sun 08:00–11:30 | 210 | EP: partial | ✅ Exists |
| 1.4 | Long day (spans lunch) | Sun 08:00–20:00 | 660 | EP: extended | ✅ Exists |
| 1.5 | Afternoon only | Sun 13:00–18:00 | 300 | EP: afternoon shift | ✅ Exists |
| 1.6 | Lunch boundary span | Sun 11:30–13:30 | 60 | BVA: lunch edge | ✅ Exists |
| 1.7 | Inside lunch window | Sun 12:30–13:30 | 60 | BVA: no deduction | ✅ Exists |
| 1.8 | Invalid dates (null/NaN) | null, Invalid Date | 0 | Error guessing | ✅ Exists |
| 1.9 | Checkout before checkin | Sun 11:00–08:00 | 0 | BVA: reversed | ✅ Exists |
| 1.10 | Minimal shift (5 min) | Sun 08:00–08:05 | 5 | BVA: minimum | ✅ Exists |
| **1.11** | **Exactly lunch window** | **Sun 12:00–13:00** | **60** | **BVA: exact lunch** | 🔴 Missing |
| **1.12** | **Start at lunch start** | **Sun 12:00–15:00** | **180** | **BVA: lunch start boundary** | 🔴 Missing |
| **1.13** | **End at lunch end** | **Sun 09:00–13:00** | **240** | **BVA: lunch end boundary** | 🔴 Missing |
| **1.14** | **Start before lunch, end during lunch** | **Sun 11:00–12:30** | **90** | **BVA: partial lunch overlap** | 🔴 Missing |
| **1.15** | **Start during lunch, end after lunch** | **Sun 12:30–14:00** | **90** | **BVA: partial lunch overlap** | 🔴 Missing |
| **1.16** | **Midnight shift (same day)** | **Sun 00:00–06:00** | **360** | **EP: early morning** | 🔴 Missing |
| **1.17** | **Same checkin/checkout time** | **Sun 08:00–08:00** | **0** | **BVA: zero duration** | 🔴 Missing |
| **1.18** | **1-minute shift** | **Sun 08:00–08:01** | **1** | **BVA: minimal** | 🔴 Missing |
| **1.19** | **23:59 checkout** | **Sun 08:00–23:59** | **899** | **BVA: end-of-day** | 🔴 Missing |

```
describe('computeAttendance weekend/holiday OT behavior')
```

| # | Test Case | Input | Expected | ISTQB Technique | Status |
|---|-----------|-------|----------|-----------------|--------|
| 1.20 | Holiday work = OT | Holiday 08:00–11:00 | status=WEEKEND_OR_HOLIDAY, work=180, ot=180 | EP: holiday | ✅ Exists |
| **1.21** | **Weekend no attendance** | **Sat, no checkIn/checkOut** | **status=WEEKEND_OR_HOLIDAY, work=0, ot=0** | **EP: no record** | 🔴 Missing |
| **1.22** | **Weekend only checkIn (incomplete)** | **Sat checkIn=08:00, no checkOut** | **status=WEEKEND_OR_HOLIDAY, work=0, ot=0** | **ST: incomplete session** | 🔴 Missing |
| **1.23** | **Weekend otApproved=true (no effect)** | **Sat 08:00–17:00, otApproved=true** | **status=WEEKEND_OR_HOLIDAY, work=480, ot=480** | **DT: flag irrelevant** | 🔴 Missing |
| **1.24** | **Holiday on weekday** | **Thu 2026-01-01 09:00–18:00** | **status=WEEKEND_OR_HOLIDAY, work=480, ot=480** | **EP: weekday holiday** | 🔴 Missing |
| **1.25** | **Holiday on weekend (overlap)** | **Sat+Holiday 08:00–12:00** | **status=WEEKEND_OR_HOLIDAY, work=240, ot=240** | **DT: dual flag** | 🔴 Missing |
| **1.26** | **Weekend with leave date (priority)** | **Sat + leaveDates has dateKey, has attendance** | **status=WEEKEND_OR_HOLIDAY** (weekend > leave priority) | **ST: priority chain** | 🔴 Missing |
| **1.27** | **Weekend late concept (never late)** | **Sat checkIn=10:00, checkOut=17:00** | **lateMinutes=0** (never late on weekend) | **EP: no late on weekend** | 🔴 Missing |
| **1.28** | **Weekend full day spanning lunch** | **Sat 07:00–22:00** | **work=840, ot=840** (15h-1h lunch=14h=840min) | **EP: max day** | 🔴 Missing |
| **1.29** | **Holiday with empty holidayDates** | **Thu 2026-01-01, holidayDates=empty Set** | **Normal workday behavior (not WEEKEND_OR_HOLIDAY)** | **DT: missing holiday set** | 🔴 Missing |

### Implementation Notes

```js
// File: attendance-compute-weekend-ot.test.js
// Pattern: Pure unit tests — no DB, no mocking timers
// Import: { computeAttendance, computeWeekendOtMinutes } from '../src/utils/attendanceCompute.js'
// Import: { createTimeInGMT7 } from '../src/utils/dateUtils.js'

describe('computeWeekendOtMinutes', () => {
  // Group 1: Equivalence Partitions (time ranges)
  //   - Morning only (before lunch)
  //   - Afternoon only (after lunch)
  //   - Full day spanning lunch
  //   - Evening/midnight shift
  
  // Group 2: Boundary Values (lunch window edges)
  //   - Exact lunch window (12:00–13:00)
  //   - Start at 12:00, end after 13:00
  //   - Start before 12:00, end at 13:00
  //   - Partial overlaps with lunch
  
  // Group 3: Degenerate inputs
  //   - Zero duration (same in/out)
  //   - Reversed in/out
  //   - Null/invalid dates
  //   - 1-minute shift
});

describe('computeAttendance weekend/holiday OT behavior', () => {
  // Group 1: Weekend (Saturday/Sunday)
  //   - With complete attendance
  //   - Without attendance
  //   - With checkIn only (incomplete)
  //   - With otApproved=true (should be irrelevant)
  
  // Group 2: Holiday (weekday)
  //   - Holiday in holidayDates set
  //   - Holiday NOT in holidayDates set (normal workday)
  
  // Group 3: Priority / Overlap
  //   - Holiday + weekend overlap
  //   - Weekend + leave date overlap (weekend wins)
  
  // Group 4: No-late invariant
  //   - Late checkin on weekend → lateMinutes always 0
});
```

---

## T2: `ot-edge-cases.test.js` (Weekend Assertions)

### Current Coverage (3 cases at lines ~942–970)

Already covers Saturday OT, Sunday morning OT, and holiday forced-true.

### Missing Edge Cases to Add

| # | Test Case | Input | Expected | ISTQB Technique | Status |
|---|-----------|-------|----------|-----------------|--------|
| 2.1 | Saturday OT (full day) | Sat 09:00–18:00, otApproved=false | status=WEEKEND_OR_HOLIDAY, work=480, ot=480 | EP | ✅ Exists |
| 2.2 | Sunday morning OT | Sun 08:00–11:00, otApproved=false | status=WEEKEND_OR_HOLIDAY, work=180, ot=180 | EP | ✅ Exists |
| 2.3 | Holiday forced-true | Weekday+holiday 09:00–18:00, otApproved=false | status=WEEKEND_OR_HOLIDAY, work=480, ot=480 | DT | ✅ Exists |
| **2.4** | **Weekend does NOT use computeOtMinutes path** | **Sat 09:00–18:00** | **otMinutes=480 (not 29 from computeOtMinutes)** | **ST: path verification** | 🔴 Missing |
| **2.5** | **Weekend does NOT use computePotentialOtMinutes** | **Sat checkout=20:00** | **otMinutes=weekendMinutes, not potentialOt** | **DT: no potential path** | 🔴 Missing |
| **2.6** | **Weekday NOT treated as weekend** | **Tue 09:00–20:00, otApproved=false** | **otMinutes=0 (not approved, not weekend)** | **EP: negative** | 🔴 Missing |
| **2.7** | **Weekend + OT request interaction** | **Sat with PENDING OT_REQUEST** | **OT computed from attendance regardless of request status** | **DT: request irrelevant** | 🔴 Missing |

### Implementation Notes

```js
// Within existing describe('computeAttendance — full integration with otApproved')
// Add after existing weekend tests

it('should NOT use computeOtMinutes path for weekend (otMinutes = full work, not post-shift-end only)', () => {
  // Saturday 09:00-16:00 (before fixed-shift OT start, but still full OT)
  // If weekday logic were used: otMinutes=0 (checkout before shift end)
  // Weekend logic: otMinutes = workMinutes = 360
});

it('should not affect weekday OT behavior (regression guard)', () => {
  // Tuesday 09:00-20:00, otApproved=false
  // Must still return otMinutes=0 (weekday path untouched)
});
```

---

## T3: `report-weekend-ot-classification.test.js`

### Current Coverage (1 case)

Classifies weekend OT as approved. Verifies `presentDays=0`.

### Missing Edge Cases to Add

| # | Test Case | Setup | Expected | ISTQB Technique | Status |
|---|-----------|-------|----------|-----------------|--------|
| 3.1 | Weekend OT classified as approved | Sat 09:00–18:00, otApproved=false | approvedOt=480, unapprovedOt=0 | EP | ✅ Exists |
| **3.2** | **Holiday OT classified as approved** | **Weekday holiday 08:00–17:00** | **approvedOt=480, unapprovedOt=0** | **EP: holiday path** | 🔴 Missing |
| **3.3** | **Multiple weekend records in month** | **2 Saturdays, 1 Sunday attendance** | **approvedOt = sum of all 3** | **EP: aggregation** | 🔴 Missing |
| **3.4** | **Mixed: weekend + weekday approved OT** | **Sat 09:00–18:00 + Tue with otApproved=true checkout=20:00** | **approvedOt = 480 + Tue_OT** | **DT: mixed sources** | 🔴 Missing |
| **3.5** | **Mixed: weekend + weekday unapproved** | **Sat 09:00–18:00 + Wed otApproved=false checkout=20:00** | **approvedOt=480, unapprovedOt=Wed_potential** | **DT: classification split** | 🔴 Missing |
| **3.6** | **Weekend with no checkout** | **Sat checkIn=09:00, no checkOut** | **work=0, ot=0 (incomplete session)** | **BVA: incomplete** | 🔴 Missing |
| **3.7** | **Holiday + weekend overlap** | **Holiday Sat 09:00–18:00, bothSets** | **approvedOt=480 (no double count)** | **DT: dual classification** | 🔴 Missing |
| **3.8** | **presentDays not increased for weekend** | **Sat+Sun attendance** | **presentDays=0** | **EP: semantics** | 🔴 Missing |
| **3.9** | **totalWorkMinutes includes weekend** | **Sat 09:00–18:00 + Mon 08:00–17:30** | **totalWork = 480 + 480** | **EP: aggregation** | 🔴 Missing |
| **3.10** | **totalOtMinutes = approvedOtMinutes** | **Sat+unapproved weekday** | **totalOt === approvedOt** | **DT: invariant** | 🔴 Missing |
| **3.11** | **Empty month (no attendance)** | **No records** | **All zeros** | **BVA: empty** | 🔴 Missing |
| **3.12** | **Weekend attendance + approved leave same user** | **Sat OT + Mon LEAVE_REQUEST approved** | **approvedOt from Sat, leaveDays includes Mon** | **DT: cross-type** | 🔴 Missing |

### Implementation Notes

```js
// File: report-weekend-ot-classification.test.js
// Pattern: Integration with MongoDB
// DB: report_weekend_ot_test_db
// Import: { getMonthlyReport } from '../src/services/reportService.js'
// Time freeze: vi.setSystemTime — set AFTER target month

describe('Monthly report weekend OT classification', () => {
  // Group 1: Single-record classification
  //   - Weekend → approved
  //   - Holiday (weekday) → approved
  //   - Holiday+weekend overlap → approved (no double count)
  
  // Group 2: Multi-record aggregation
  //   - Multiple weekends → sum approved
  //   - Weekend + weekday approved → sum both sources
  //   - Weekend + weekday unapproved → split correctly
  
  // Group 3: Edge / invariant
  //   - Weekend incomplete session → 0
  //   - presentDays unchanged by weekend
  //   - totalOtMinutes === approvedOtMinutes invariant
  //   - Empty month → all zeros
  
  // Group 4: Cross-type interaction
  //   - Weekend OT + approved leave (no conflict)
});
```

---

## T4: `today-activity-weekend-ot.test.js`

### Current Coverage (2 cases)

With attendance (metrics populated) and without attendance (zero metrics).

### Missing Edge Cases to Add

| # | Test Case | Setup | Expected | ISTQB Technique | Status |
|---|-----------|-------|----------|-----------------|--------|
| 4.1 | Weekend with attendance → metrics | Sun 08:00–11:00 | status=WEEKEND_OR_HOLIDAY, work=180, ot=180 | EP | ✅ Exists |
| 4.2 | Weekend without attendance → zero | Sun, no record | status=WEEKEND_OR_HOLIDAY, work=0, ot=0 | EP | ✅ Exists |
| **4.3** | **Weekend with checkIn only (in-progress)** | **Sun checkIn=08:00, no checkOut** | **status=WEEKEND_OR_HOLIDAY, work=0, ot=0** | **ST: incomplete** | 🔴 Missing |
| **4.4** | **Holiday (weekday) with attendance** | **Holiday Thu 09:00–17:00, holidayDates has key** | **status=WEEKEND_OR_HOLIDAY, work=480, ot=480** | **EP: holiday** | 🔴 Missing |
| **4.5** | **Holiday (weekday) without attendance** | **Holiday Thu, no record, holidayDates has key** | **status=WEEKEND_OR_HOLIDAY, all=0** | **EP: holiday empty** | 🔴 Missing |
| **4.6** | **Saturday (vs Sunday — both weekend)** | **Sat 09:00–12:00** | **status=WEEKEND_OR_HOLIDAY, work=180, ot=180** | **EP: Saturday** | 🔴 Missing |
| **4.7** | **Weekend lateMinutes always 0** | **Sun checkIn=12:00** | **lateMinutes=0** | **EP: never late** | 🔴 Missing |
| **4.8** | **Weekend otMinutes === workMinutes invariant** | **Sun 08:00–20:00** | **otMinutes === workMinutes** | **DT: invariant** | 🔴 Missing |
| **4.9** | **Normal weekday (regression)** | **Freeze to Tuesday, attendance** | **status=ON_TIME/LATE, normal computation** | **EP: negative test** | 🔴 Missing |
| **4.10** | **Multiple users mixed (weekend)** | **User A: attendance, User B: no attendance** | **Both WEEKEND_OR_HOLIDAY, different metrics** | **EP: multi-user** | 🔴 Already covered by 4.1+4.2 combination |
| **4.11** | **Computed response has all 4 fields** | **Any weekend attendance** | **computed has status, lateMinutes, workMinutes, otMinutes** | **Contract test** | 🔴 Missing |
| **4.12** | **Pagination on weekend** | **3+ users, page=1 limit=2** | **Correct pagination, all items have weekend status** | **EP: pagination** | 🔴 Missing |

### Implementation Notes

```js
// File: today-activity-weekend-ot.test.js
// Pattern: Integration with MongoDB
// DB: today_activity_weekend_ot_test_db
// Time freeze: vi.setSystemTime to target Sunday/Saturday/holiday
// Import: { getTodayActivity } from '../src/services/attendanceService.js'

describe('getTodayActivity weekend metrics', () => {
  // Group 1: Weekend basic scenarios
  //   - Sun with complete attendance → metrics
  //   - Sun without attendance → zero metrics
  //   - Sun with checkIn only → zero metrics (incomplete)
  //   - Sat equivalent of above
  
  // Group 2: Holiday (weekday) scenarios
  //   - Holiday with attendance → metrics
  //   - Holiday without attendance → zero
  
  // Group 3: Invariants
  //   - lateMinutes always 0 on weekend/holiday
  //   - otMinutes === workMinutes on weekend/holiday
  //   - computed response shape has all 4 fields
  
  // Group 4: Regression
  //   - Regular weekday returns normal status (ON_TIME/LATE etc)
  
  // Group 5: Pagination
  //   - Multiple users with pagination
});
```

---

## T5: `weekend-ot-regression.test.js` *(NEW — to be created)*

### Purpose

Guard that existing weekday OT behavior is NOT affected by the weekend/holiday OT changes.

### Test Cases

| # | Test Case | Input | Expected | ISTQB Technique |
|---|-----------|-------|----------|-----------------|
| 5.1 | Weekday checkout after shift end with otApproved=true | Tue 08:00–20:00, approved | otMinutes>0 (from computeOtMinutes), workMinutes=510 | EP: weekday OT |
| 5.2 | Weekday checkout after shift end with otApproved=false | Tue 08:00–20:00, not approved | otMinutes=0, workMinutes=510 | EP: strict rule |
| 5.3 | Weekday checkout before 17:30 | Tue 08:00–16:00 | otMinutes=0, status=EARLY_LEAVE | EP: no OT |
| 5.4 | Weekday late + OT approved | Tue 09:30–20:00, approved | lateMinutes=90, otMinutes=150, status=LATE | EP: combined |
| 5.5 | Weekday computeWorkMinutes keeps in-shift overlap without approval | Tue 08:00–20:00, otApproved=false | workMinutes=510 (08:00–17:30 minus lunch) | BVA: cap |
| 5.6 | Weekday computeWorkMinutes stays in-shift overlap with approval | Tue 08:00–20:00, otApproved=true | workMinutes=510 (08:00–17:30 minus lunch) | BVA: no overlap |
| 5.7 | Weekday report: unapproved OT classification | Tue 08:00–20:00 otApproved=false | unapprovedOtMinutes = computePotentialOtMinutes | DT: classification |
| 5.8 | Weekday report: approved OT classification | Tue 08:00–20:00 otApproved=true | approvedOtMinutes from computeOtMinutes | DT: classification |
| 5.9 | computeOtMinutes still requires approval on weekday | Tue checkout=20:00, otApproved=false | 0 | EP: strict |
| 5.10 | computePotentialOtMinutes ignores approval | Tue checkout=20:00 | >0 regardless of flag | EP: always computes |

### Implementation Notes

```js
// File: weekend-ot-regression.test.js
// Pattern: Pure unit tests for computation, integration for report
// Import: { computeAttendance, computeWorkMinutes, computeOtMinutes,
//           computePotentialOtMinutes } from '../src/utils/attendanceCompute.js'

describe('Weekday OT regression guard — no behavior change', () => {
  // Group 1: computeAttendance weekday path
  //   - otApproved=true → regular work + approved OT split
  //   - otApproved=false → regular work only, no OT
  //   - Early leave, late, on-time statuses unchanged
  
  // Group 2: computeWorkMinutes fixed-shift behavior
  //   - Regular work ends at shift end regardless of otApproved
  //   - Pre-shift time is ignored
  
  // Group 3: computeOtMinutes strict rule
  //   - Returns 0 when !otApproved
  //   - Returns minutes after shift end when approved
  
  // Group 4: Report classification weekday
  //   - otApproved=true → approvedOtMinutes
  //   - otApproved=false → unapprovedOtMinutes via computePotentialOtMinutes
});
```

---

## Cross-Cutting Edge Cases (Decision Table)

These cases span multiple test files and should be verified at the appropriate level:

### Decision Table: OT Classification

| Day Type | otApproved | Has checkIn/Out | Expected otMinutes | Expected Classification |
|----------|------------|-----------------|--------------------|-----------------------|
| Weekend  | false      | Yes (complete)   | = workMinutes      | approved              |
| Weekend  | true       | Yes (complete)   | = workMinutes      | approved              |
| Weekend  | false      | No               | 0                  | N/A                   |
| Weekend  | false      | checkIn only     | 0                  | N/A (incomplete)      |
| Holiday  | false      | Yes (complete)   | = workMinutes      | approved              |
| Holiday  | true       | Yes (complete)   | = workMinutes      | approved              |
| Weekday  | false      | Yes (after shift end)| 0               | unapproved (potential)|
| Weekday  | true       | Yes (after shift end)| >0 (after shift end) | approved          |
| Weekday  | false      | Yes (before 17:30)| 0                 | N/A                   |

### State Transition: Attendance Session on Weekend

```
[No Record] → checkIn → [checkIn only, ot=0] → checkOut → [complete, ot=workMinutes]
                                                     ↓
                                          [WEEKEND_OR_HOLIDAY status throughout]
```

### Boundary Values: Lunch Deduction on Weekend

| Scenario | checkIn | checkOut | Spans Lunch? | Deduction | Expected |
|----------|---------|----------|-------------|-----------|----------|
| Before lunch | 08:00 | 11:59 | No | 0 | 239 |
| Exact lunch start to after | 12:00 | 14:00 | No (checkIn NOT < 12:00) | 0 | 120 |
| Before to exact lunch end | 11:00 | 13:00 | No (checkOut NOT > 13:00) | 0 | 120 |
| Before to after lunch | 11:00 | 13:01 | Yes | 60 | 61 |
| Full span | 08:00 | 17:00 | Yes | 60 | 480 |
| After lunch | 13:01 | 18:00 | No | 0 | 299 |

> **Note**: Lunch deduction rule is: `checkIn < 12:00 AND checkOut > 13:00` (strict inequality). Edge cases at exact 12:00 and 13:00 boundaries are critical.

---

## Phase-Locked Edge Cases (from Implementation Plan §6)

| # | Scenario | Expected | Test File |
|---|----------|----------|-----------|
| P6.1 | Weekend checkIn, no checkOut | OT=0 | T1 (1.22), T4 (4.3) |
| P6.2 | Weekend 08:00–08:05 | OT=5 | T1 (1.10) ✅ |
| P6.3 | Holiday on weekend (overlap) | OT=total work | T1 (1.25), T3 (3.7) |
| P6.4 | Cross-midnight before reconcile | Compute by current record | T2 (edge suite) |
| P6.5 | Cross-midnight after FORGOT_CHECKOUT | Recompute with new checkout | T2 (edge suite) |
| P6.6 | Lunch deduction same as computeWorkMinutes | Consistent deduction | T1 (all lunch BVA) |
| P6.7 | computePotentialOtMinutes not used for weekend/holiday | Not called in weekend path | T2 (2.5), T3 (3.5) |
| P6.8 | presentDays = workdays only | Weekend attendance → presentDays=0 | T3 (3.8) |

---

## Test Execution Order

```
1. attendance-compute-weekend-ot.test.js     (unit, fast, no DB)
2. weekend-ot-regression.test.js             (unit, fast, no DB)
3. ot-edge-cases.test.js                     (mixed, isolated DB)
4. report-weekend-ot-classification.test.js  (integration, isolated DB)
5. today-activity-weekend-ot.test.js         (integration, isolated DB)
```

**Command**:
```bash
npm test attendance-compute-weekend-ot.test.js weekend-ot-regression.test.js ot-edge-cases.test.js report-weekend-ot-classification.test.js today-activity-weekend-ot.test.js
```

---

## Quality Gates

### Entry Criteria
- [x] `computeWeekendOtMinutes` implemented
- [x] `computeAttendance` weekend branch updated
- [x] `reportService.js` classification logic updated
- [x] `getTodayActivity` control flow restructured

### Exit Criteria
- [ ] All test cases pass (100% pass rate)
- [ ] No regression in existing 50+ test files
- [ ] Code coverage >80% on modified files
- [ ] Full `npm test` suite passes

### Coverage Targets

| Module | Line Coverage | Branch Coverage |
|--------|-------------|----------------|
| `attendanceCompute.js` | >90% | >85% |
| `reportService.js` (OT section) | >80% | >80% |
| `attendanceService.js` (getTodayActivity) | >80% | >80% |

---

## Summary: Total Edge Cases

| File | Existing | Missing/New | Total |
|------|----------|-------------|-------|
| T1: `attendance-compute-weekend-ot.test.js` | 11 | 18 | 29 |
| T2: `ot-edge-cases.test.js` (weekend section) | 3 | 4 | 7 |
| T3: `report-weekend-ot-classification.test.js` | 1 | 11 | 12 |
| T4: `today-activity-weekend-ot.test.js` | 2 | 9 | 11 |
| T5: `weekend-ot-regression.test.js` (new) | 0 | 10 | 10 |
| **Total** | **17** | **52** | **69** |

### Effort Estimate

| File | Story Points | Type |
|------|-------------|------|
| T1 additions | 1 SP | Unit (pure, fast) |
| T2 additions | 0.5 SP | Unit within existing suite |
| T3 additions | 2 SP | Integration (DB seed + report) |
| T4 additions | 1.5 SP | Integration (DB + time freeze) |
| T5 new file | 1.5 SP | Unit + light integration |
| **Total** | **6.5 SP** | |
