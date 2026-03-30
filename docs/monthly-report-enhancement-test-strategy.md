# Test Strategy: Monthly Report Enhancement

**Feature**: Monthly Report Data Completeness and Excel Export Enhancement  
**Version**: 2.0  
**Priority**: P0 (Production Critical)  
**Created**: March 3, 2026  
**Framework**: ISTQB Test Process + ISO 25010 Quality Model

---

## Test Strategy Overview

### Testing Scope

This test strategy covers the enhancement of the monthly report functionality to address 7 identified conflicts (C1-C7) and 3 data gaps (GAP-1, GAP-2, GAP-3) across:

**Backend Components:**
- `server/src/services/reportService.js` - Report calculation logic
- `server/src/services/exportService.js` - Excel generation
- `server/src/utils/dateUtils.js` - Date/timezone utilities
- `server/src/controllers/reportController.js` - API layer (minimal changes)

**Frontend Components:**
- `client/src/pages/MonthlyReportPage.jsx` - Report UI with team selector

**API Endpoints:**
- `GET /api/reports/monthly` - Report data retrieval
- `GET /api/reports/monthly/export` - Excel file generation

### Quality Objectives

| Quality Goal | Success Criteria | Measurement Method |
|-------------|------------------|-------------------|
| **Data Accuracy** | 100% correct calculation for all 7 conflicts | Unit + integration tests |
| **Business Logic Correctness** | absentDays computed using elapsed workdays only | Boundary value testing |
| **Data Completeness** | 16-column report with all required fields | Contract validation tests |
| **Excel Format Integrity** | Hour columns are numeric (not string) | Export format validation |
| **Admin UX Consistency** | Admin team scope requires team selection | E2E Playwright tests |
| **Regression Safety** | No existing functionality broken | Regression test suite |
| **Code Coverage** | >85% line coverage for modified code | Vitest coverage report |

### Risk Assessment

| Risk | Impact | Probability | Mitigation Strategy | Priority |
|------|--------|-------------|---------------------|----------|
| **Double-counting present/leave days** | High | Medium | Set-based logic + comprehensive unit tests (C3) | P1 |
| **Incorrect absent days for current month** | High | High | Separate elapsedWorkdays calculation + boundary tests (C2) | P0 |
| **Admin team scope bypassed** | Medium | Medium | Frontend validation + E2E tests (C1) | P0 |
| **Excel hour columns as strings** | Low | Low | Type validation + export tests (C6) | P2 |
| **Leave cross-month calculation errors** | High | Medium | Overlap clip logic + integration tests (N2, GAP-1) | P1 |
| **Regression in existing OT/late calculations** | Medium | Low | Existing test suite + regression checks | P1 |

### Test Approach

**Testing Methodology**: Risk-based testing prioritizing P0/P1 conflicts, combining ISTQB black-box techniques with white-box structural coverage analysis.

---

## ISTQB Framework Implementation

### Test Design Techniques Selection

#### 1. **Equivalence Partitioning**

**Apply to**: Input domain partitioning for date ranges and status calculations

| Input Domain | Valid Partitions | Invalid Partitions | Test Coverage |
|--------------|-----------------|-------------------|---------------|
| **Month Selection** | Past months, Current month, Future months | Invalid date formats | C2 elapsed logic |
| **User Scope** | Company (Admin), Team (Admin with teamId), Own team (Manager) | Missing teamId for Admin team scope | C1 validation |
| **Attendance Status** | Present statuses: `{ON_TIME, LATE, EARLY_LEAVE, LATE_AND_EARLY, WORKING, MISSING_CHECKOUT}` | Invalid statuses | C3 set logic |
| **Leave Types** | `ANNUAL`, `SICK`, `UNPAID`, `null` | Invalid enum values | C4 breakdown |
| **Day Types** | Workday, Weekend, Holiday | Edge cases (public holiday on weekend) | GAP-1 filtering |

#### 2. **Boundary Value Analysis**

**Apply to**: Edge cases for date boundaries, time calculations, and numeric thresholds

| Boundary | Lower Bound | On Lower | Nominal | On Upper | Upper Bound | Test Case Focus |
|----------|------------|----------|---------|----------|-------------|----------------|
| **Month Start/End** | Last day of prev month | Month start date | Mid-month | Last day of month | First day next month | C2 elapsed window |
| **Today in Month** | Month start = today | today = monthStart+1 | Mid-month today | today = monthEnd-1 | today = monthEnd | C2 current month absent days |
| **Work Minutes** | 0 minutes | 1 minute | 480 minutes (8h) | 540 minutes (9h) | 720 minutes (12h) | OT calculation accuracy |
| **Late Minutes** | 0 late | 1 minute late | 30 minutes late | 59 minutes late | 60+ minutes late | C5 lateDetails sorting |
| **Leave Cross-Month** | Leave entirely before month | Leave starts last day before month | Leave overlap start/end | Leave ends first day after month | Leave entirely after month | N2 overlap clipping |

#### 3. **Decision Table Testing**

**Apply to**: Complex business rule validation for absentDays calculation

| Condition | Test Case 1 | Test Case 2 | Test Case 3 | Test Case 4 | Test Case 5 |
|-----------|-------------|-------------|-------------|-------------|-------------|
| **Is Workday?** | YES | YES | YES | NO | YES |
| **Is in Elapsed Window?** | YES | YES | YES | YES | NO |
| **Has Present Status?** | YES | NO | NO | NO | NO |
| **Has Approved Leave?** | NO | YES | NO | NO | NO |
| **Expected absentDays Count** | 0 | 0 | +1 | 0 | 0 |
| **Conflict Coverage** | C3 | C3, GAP-1 | C2, C3 | GAP-1 | C2 |

#### 4. **State Transition Testing**

**Apply to**: Admin scope selection flow

```
[Initial Load] 
   ↓
[No Scope Selected] → [Select "Company"] → [Report Loaded: All Users]
   ↓
[Select "Team"] → [Team Selector Shown] 
   ↓
[No Team Selected] → [Fetch/Export Disabled] (C1 validation)
   ↓
[Team Selected] → [teamId sent to API] → [Report Loaded: Team Users]
```

**Invalid Transitions to Test:**
- Admin selects "Team" scope but API called without teamId (must be blocked)
- Admin team scope auto-forced to "Company" (C1 conflict - must be removed)

#### 5. **Experience-Based Testing**

**Apply to**: Known production patterns and error-prone areas

- **Error Guessing**: Test scenarios where users commonly make mistakes
  - Selecting future month and expecting absent days
  - Leave spanning multiple months with mixed workdays/weekends
  - Cross-midnight attendance records affecting daily calculations
  
- **Exploratory Testing**: Validate edge cases discovered during development
  - Empty team selection edge case (GAP-3 subtitle fallback)
  - Multiple late check-ins on same day sorting
  - Weekend leave requests not inflating absent days

---

### Test Types Coverage Matrix

| Test Type | Priority | Scope | Tools | Coverage Target |
|-----------|----------|-------|-------|----------------|
| **Functional Testing** | Critical | All conflicts C1-C7, gaps GAP-1 to GAP-3 | Vitest, Supertest | 100% acceptance criteria |
| **Unit Testing** | High | Service layer logic: `computeUserMonthlySummary()`, date utils | Vitest | >85% line coverage |
| **Integration Testing** | High | API endpoints with DB, cross-service interactions | Vitest + Supertest | All conflict scenarios |
| **End-to-End Testing** | High | Admin team selector flow, report rendering, export download | Playwright | Critical user paths (C1) |
| **Regression Testing** | Critical | Existing OT, late, leave calculations unchanged | Existing test suite | 100% existing tests pass |
| **Non-Functional Testing** | Medium | Excel file format validation, performance | Manual + scripts | C6 numeric validation |
| **Security Testing** | Low | Admin RBAC for teamId parameter | Existing security tests | No new vulnerabilities |

---

## ISO 25010 Quality Characteristics Assessment

### Priority Matrix

| Quality Characteristic | Sub-Characteristics | Priority | Validation Approach | Test Coverage |
|----------------------|-------------------|----------|-------------------|---------------|
| **Functional Suitability** | Completeness, Correctness, Appropriateness | **Critical** | All 16 fields present, calculations match specification | C1-C7, GAP-1 to GAP-3 |
| **Performance Efficiency** | Time Behavior | Medium | Report generation <3s for 100 users/month | Load testing (existing) |
| **Compatibility** | Co-existence | Low | Excel file opens in Excel/Google Sheets/LibreOffice | Manual validation |
| **Usability** | User Interface Aesthetics, Operability | **High** | Admin team selector intuitive, no forced scope change | C1 E2E tests, N6 UX |
| **Reliability** | Fault Tolerance | High | Graceful handling of missing teamId, empty teams | Error case tests |
| **Security** | Authentication, Authorization | Medium | Admin cannot access unauthorized team data | RBAC tests (existing) |
| **Maintainability** | Modularity, Reusability, Testability | **High** | Clear separation: `computeUserMonthlySummary` vs `getMonthlyReport` | GAP-2, C7 code review |
| **Portability** | Adaptability | Low | Timezone handling via GMT+7 utils | C7 util reuse |

### Functional Suitability - Deep Dive (Critical)

**Completeness Assessment:**
- ✅ All 16 report columns specified and implemented
- ✅ Leave breakdown by type (`ANNUAL`, `SICK`, `UNPAID`, `UNSPECIFIED`)
- ✅ Late details with deterministic sorting
- ✅ Team name populated for each user
- ✅ Separate sheet for late details in Excel export

**Correctness Validation:**
| Calculation | Formula | Test Cases |
|------------|---------|------------|
| `totalWorkdays` | `countWorkdays(monthStart, monthEnd, holidayDates)` | Full month, partial month, all weekends |
| `elapsedWorkdays` | Based on month status (past/current/future) | Past=full, current=up to today, future=0 |
| `absentDays` | `size(elapsedWorkdaySet - presentDateSet - leaveDateSetElapsedWorkday)` | C2, C3 edge cases |
| `leaveDays` (display) | Leave workdays for full month (not just elapsed) | N2 cross-month overlap |
| `leaveByType` | Group by `leaveType` enum | C4 uppercase + null handling |

**Appropriateness:**
- Elapsed-based absent days appropriate for current month (C2 rationale)
- Set-based logic prevents double-counting (C3 rationale)
- Team selector for Admin appropriate for team-scoped reports (C1 rationale)

---

## Test Environment and Data Strategy

### Test Environment Requirements

| Environment | Purpose | Configuration | Data Source |
|-------------|---------|---------------|-------------|
| **Unit Test (Vitest)** | Isolated service/util testing | In-memory, mocked DB | Fixtures |
| **Integration Test (Vitest + Supertest)** | API + Service + DB | Test MongoDB instance | Seeded test data |
| **E2E Test (Playwright)** | Full stack browser testing | Local dev server (client+server) | Test user accounts |
| **Manual Validation** | Excel format verification | Excel/Google Sheets desktop | Exported test reports |

### Test Data Management Strategy

#### Test Data Sets

**Dataset 1: Basic Calculation Validation**
- 3 users (Admin, Manager, Employee)
- 1 full past month with mixed attendance (present, absent, leave)
- Include: workdays, weekends, 1 holiday
- Purpose: Validate basic summary calculations (C2, C3)

**Dataset 2: Leave Edge Cases**
- 2 users with cross-month leave requests
- Leave types: ANNUAL, SICK, UNPAID, null
- Overlapping weekends and holidays within leave period
- Purpose: Validate GAP-1 (leave workday filtering), C4 (leaveType enum), N2 (overlap clipping)

**Dataset 3: Late Details Sorting**
- 1 user with multiple late check-ins in same month
- Include: Same-day multiple lates, different dates, different late times
- Purpose: Validate C5 (deterministic sorting)

**Dataset 4: Admin Team Scope**
- Admin user with access to multiple teams
- 2 teams with different users
- Purpose: Validate C1 (team selector, teamId requirement)

**Dataset 5: Current Month Elapsed Logic**
- Today = mid-month (e.g., 15th)
- Users with attendance records past today (should not affect absentDays)
- Purpose: Validate C2 (elapsed window boundary)

**Dataset 6: Empty/Edge Teams**
- Team with no users (GAP-3 subtitle fallback)
- Team with 1 user
- Purpose: Validate edge case handling

#### Data Privacy and Maintenance

- **Isolation**: Each test uses independent data to prevent side effects
- **Cleanup**: `afterEach()` hooks clear test data
- **Fixtures**: Reusable factory functions for generating test users/attendance/leaves
- **Anonymization**: Test data uses fictional names and employee codes

---

## Test Tools and CI/CD Integration

### Testing Tools Stack

| Tool | Purpose | Integration |
|------|---------|-------------|
| **Vitest** | Unit + Integration testing | `npm test` in server/ |
| **Supertest** | API endpoint testing | Used within Vitest tests |
| **Playwright** | E2E testing | `npm run e2e` in client/ |
| **ExcelJS** | Excel parsing for validation | Custom validation scripts |
| **c8** | Code coverage reporting | Integrated with Vitest |

### CI/CD Pipeline Integration

```yaml
# Proposed test stages (pseudo-pipeline)
stages:
  - lint
  - unit-test
  - integration-test
  - e2e-test
  - coverage-check

unit-test:
  command: cd server && npm test -- --coverage
  success-criteria: >85% coverage, 0 failures

integration-test:
  command: cd server && npm test -- tests/monthly-report-enhanced.test.js
  depends-on: unit-test

e2e-test:
  command: cd client && npx playwright test e2e/monthly-report.spec.js
  depends-on: integration-test

coverage-check:
  command: Check coverage thresholds
  fail-if: coverage < 85% for modified files
```

---

## Test Execution Strategy

### Test Phases

**Phase 1: Unit Testing (Days 1-2)**
- Focus: Service layer logic, date utils
- Files: `reportService.js`, `dateUtils.js`, `exportService.js`
- Coverage: C2, C3, C4, C5, C7, GAP-1, GAP-2

**Phase 2: Integration Testing (Days 2-3)**
- Focus: API endpoints with MongoDB
- Files: API routes + controllers + services
- Coverage: C1 (API teamId validation), C2-C5 (end-to-end data flow)

**Phase 3: E2E Testing (Days 3-4)**
- Focus: Frontend team selector + report rendering + export
- Files: `MonthlyReportPage.jsx` + API
- Coverage: C1 (team selector UX), N6 (label wording)

**Phase 4: Excel Validation (Day 4)**
- Focus: Exported file format and numeric columns
- Files: Generated .xlsx files
- Coverage: C6 (numeric hour columns)

**Phase 5: Regression Testing (Day 5)**
- Focus: Existing functionality unchanged
- Files: All existing test suites
- Coverage: No regressions in OT, leave, late calculations

### Entry Criteria

- [ ] All implementation code complete and passing linting
- [ ] Test environment setup complete (MongoDB test instance, test users)
- [ ] Test data fixtures prepared (6 datasets above)
- [ ] Playwright E2E environment configured

### Exit Criteria

- [ ] 100% of conflict test cases (C1-C7) passing
- [ ] 100% of gap test cases (GAP-1 to GAP-3) passing
- [ ] >85% code coverage on modified files
- [ ] All existing tests still passing (0 regressions)
- [ ] E2E tests for C1 (Admin team selector) passing
- [ ] Manual Excel validation confirmed (C6)
- [ ] No P0/P1 defects open

---

## Success Metrics

### Test Coverage Metrics

| Metric | Target | Measurement | Rationale |
|--------|--------|-------------|-----------|
| **Line Coverage** | >85% | Vitest c8 report | Modified files only |
| **Branch Coverage** | >80% | Vitest c8 report | Critical paths (calculations) |
| **Conflict Coverage** | 100% | Manual checklist | All C1-C7 validated |
| **Gap Coverage** | 100% | Manual checklist | All GAP-1 to GAP-3 validated |
| **Acceptance Criteria** | 100% | Test case execution | All AC in implementation plan |

### Quality Validation Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| **Defect Detection Rate** | >95% before production | Test execution results |
| **Test Automation Coverage** | >90% (E2E: C1 only) | Automated vs manual tests |
| **Regression Pass Rate** | 100% | Existing test suite results |
| **Test Execution Time** | <5 minutes (unit+integration) | CI/CD pipeline timing |

### Process Efficiency Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| **Test Development Time** | <1 day per priority conflict | Time tracking |
| **Defect Fix Turnaround** | <1 day for P0/P1 | Issue tracker |
| **Test Maintenance Effort** | <2 hours/month | Ongoing maintenance log |

---

## Risk Mitigation and Contingency

### High-Risk Scenarios

**Scenario 1: Elapsed Logic Breaks Existing Reports**
- **Risk**: Change to elapsed-based absent days affects historical data interpretation
- **Mitigation**: Comprehensive regression suite + side-by-side comparison tests
- **Contingency**: Feature flag to toggle elapsed logic if rollback needed

**Scenario 2: Excel Export Format Breaking Change**
- **Risk**: C6 numeric formatting breaks compatibility with old Excel versions
- **Mitigation**: Test .xlsx in Excel 2016+, Excel 365, Google Sheets, LibreOffice
- **Contingency**: Keep string + manual conversion as fallback if issues found

**Scenario 3: Admin Team Selector Confuses Users**
- **Risk**: C1 change requires Admin to select team, may be unexpected
- **Mitigation**: Clear UI messaging, N6 label improvement
- **Contingency**: Add help text/tooltip explaining team selection requirement

---

## Test Dependencies and Sequencing

### Critical Path

```
[dateUtils.js tests] 
   ↓ (C7 reuse validation)
[reportService.js unit tests]
   ↓ (C2, C3, C4, GAP-1, GAP-2)
[exportService.js unit tests]
   ↓ (C5, C6)
[Integration tests (API + DB)]
   ↓ (End-to-end data flow)
[E2E tests (Frontend + API)]
   ↓ (C1 team selector)
[Regression suite]
```

### Parallel Testing Opportunities

- Unit tests for `dateUtils`, `reportService`, `exportService` can run in parallel
- Frontend E2E and backend integration tests can be developed in parallel
- Excel format validation can run independently

---

## Approval and Sign-off

| Role | Name | Responsibility | Sign-off Date |
|------|------|---------------|---------------|
| **QA Lead** | _[Pending]_ | Test strategy approval | _[Date]_ |
| **Tech Lead** | _[Pending]_ | Technical approach validation | _[Date]_ |
| **Product Owner** | _[Pending]_ | Business logic confirmation | _[Date]_ |

---

## Appendix: Conflict-to-Test Mapping

| Conflict ID | Priority | Test Level | Test Files | Estimated Test Cases |
|------------|----------|-----------|-----------|---------------------|
| C1 | P0 | E2E + Integration | `monthly-report.spec.js`, `reportController.test.js` | 5 |
| C2 | P0 | Unit + Integration | `reportService.test.js` | 8 |
| C3 | P1 | Unit | `reportService.test.js` | 6 |
| C4 | P1 | Unit | `reportService.test.js` | 4 |
| C5 | P1 | Unit | `reportService.test.js`, `exportService.test.js` | 3 |
| C6 | P2 | Manual + Scripts | `excel-validation.js` | 4 |
| C7 | P2 | Unit | `dateUtils.test.js` | 2 |
| GAP-1 | P1 | Unit + Integration | `reportService.test.js` | 5 |
| GAP-2 | P2 | Unit (code structure) | `reportService.test.js` | 2 |
| GAP-3 | P2 | Unit + E2E | `exportService.test.js`, `monthly-report.spec.js` | 2 |

**Total Estimated Test Cases**: 41

---

**Document Status**: Draft for Review  
**Next Review Date**: [Implementation Start Date]  
**Change Log**: Initial version created March 3, 2026
