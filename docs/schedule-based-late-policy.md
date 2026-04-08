# Schedule-Based Late Policy (Source of Truth)

Timezone: Asia/Ho_Chi_Minh (GMT+7)  
All workday late evaluation in this document uses GMT+7.

## Purpose and Ownership
This document is the source of truth for **schedule-based late evaluation on workdays**.

It owns:
- how `scheduleType` affects workday late evaluation
- how `lateMinutes` is derived from a fixed-shift start time
- when `FLEXIBLE` skips late evaluation
- the rule order between calendar checks, schedule enforcement, and fixed-shift late checks

It does **not** own:
- OT approval or OT calculation
- weekend/holiday OT behavior
- payroll, leave, or absence policy
- check-in authorization or UI navigation
- request workflows or reconciliation workflows

If this document conflicts with [`rules.md`](/Users/truongphuc/Desktop/phuctruong_6jan/code_folder/docs/rules.md) on **workday late evaluation**, this document wins.  
For OT, holidays/weekends, leave, `UNREGISTERED`, and request behavior, [`rules.md`](/Users/truongphuc/Desktop/phuctruong_6jan/code_folder/docs/rules.md) remains authoritative.

## Schedule Types

| `scheduleType` | Shift Start | Grace Window | Late Starts At | Related Fixed-Shift End | Related Fixed-Shift OT Start |
|---|---:|---:|---:|---:|---:|
| `SHIFT_1` | 08:00 | 08:00-08:05 | 08:06 | 17:30 | 17:30 |
| `SHIFT_2` | 09:00 | 09:00-09:05 | 09:06 | 18:30 | 18:30 |
| `FLEXIBLE` | n/a | n/a | n/a | n/a | n/a |

Notes:
- `SHIFT_1` and `SHIFT_2` support late evaluation.
- `FLEXIBLE` does not produce `lateMinutes`.
- Related fixed-shift end times and OT start times are listed for context only. OT behavior is still owned by [`rules.md`](/Users/truongphuc/Desktop/phuctruong_6jan/code_folder/docs/rules.md) §10.

## Evaluation Order
Apply rules in this order:

1. Calendar classification
   - If `workDate` is weekend or holiday, do **not** evaluate lateness.
   - Non-workday OT and work-minute behavior remain owned by [`rules.md`](/Users/truongphuc/Desktop/phuctruong_6jan/code_folder/docs/rules.md) §§3.1 and 10.6.

2. Schedule enforcement and registration validity
   - If schedule enforcement is active and there is no valid registration for the date, the attendance-state layer may surface `UNREGISTERED`.
   - Check-in blocking, redirects, and schedule registration UX are not owned by this document.
   - The enforcement switch is currently tied to `SCHEDULE_ENFORCEMENT_START_DATE`.

3. Schedule type handling
   - If the effective `scheduleType` is `FLEXIBLE`, stop here: no late evaluation is performed.

4. Fixed-shift late evaluation
   - If the effective `scheduleType` is `SHIFT_1` or `SHIFT_2`, evaluate late status and `lateMinutes` using the rules below.

## Fixed-Shift Late Evaluation

### Inputs
- `workDate`
- persisted attendance `checkInAt`
- effective schedule snapshot:
  - `scheduleType`
  - `scheduledStartMinutes`
  - `lateGraceMinutes`
  - `lateTrackingEnabled`
  - `scheduleSource`

This policy evaluates the persisted attendance `checkInAt` value. Upstream normalization of multiple raw check-in events is out of scope for this document.

### Precision
- Evaluation is minute-based.
- If `checkInAt` contains seconds, minute differences are effectively rounded down to the previous whole minute.

### Rule
Grace only decides whether the user is considered late.  
Once late applies, `lateMinutes` is counted from the official shift start, not from the grace threshold.

Formula:

```text
if checkInAt <= lateThreshold:
    lateMinutes = 0
else:
    lateMinutes = floor((checkInAt - shiftStart) / 1 minute)
```

Where:
- `SHIFT_1`
  - `shiftStart = 08:00`
  - `lateThreshold = 08:05`
- `SHIFT_2`
  - `shiftStart = 09:00`
  - `lateThreshold = 09:05`

Examples:
- `SHIFT_1`, `08:05` => `lateMinutes = 0`
- `SHIFT_1`, `08:06` => `lateMinutes = 6`
- `SHIFT_1`, `08:31` => `lateMinutes = 31`
- `SHIFT_2`, `09:05` => `lateMinutes = 0`
- `SHIFT_2`, `09:06` => `lateMinutes = 6`
- `SHIFT_2`, `09:31` => `lateMinutes = 31`

## FLEXIBLE and Non-Workdays

### `FLEXIBLE` on Workdays
- no late evaluation
- `lateMinutes = 0`
- no `Late` label
- no `late_level` contract

This document does **not** redefine OT, payroll, leave, or attendance-completion behavior for `FLEXIBLE`.

### Weekend or Holiday
- no late evaluation for any `scheduleType`
- do not infer on-time vs late from non-workday check-ins
- OT and work-minute treatment on non-workdays remain owned by [`rules.md`](/Users/truongphuc/Desktop/phuctruong_6jan/code_folder/docs/rules.md) §10.6

## Compatibility Notes
- The normative business rule for new workdays is: use the registered work schedule for that date.
- Current code also supports a compatibility path where missing schedule snapshot fields may be backfilled as:
  - `scheduleSource = LEGACY_BACKFILL`
  - fallback `scheduleType = SHIFT_1`
- That compatibility behavior exists to support legacy data. It is **not** the normative policy for new registrations.

## Appendix: Optional `late_level` Guidance (Non-Contract)
`late_level` is UI guidance only in this document. It is not part of the current API or database contract.

| `scheduleType` | `late_level` | Check-in Range | Suggested Label |
|---|---:|---|---|
| `SHIFT_1` | 0 | 08:00-08:05 | On time |
| `SHIFT_1` | 1 | 08:06-08:30 | Late level 1 |
| `SHIFT_1` | 2 | 08:31-09:00 | Late level 2 |
| `SHIFT_1` | 3 | 09:01+ | Late level 3 |
| `SHIFT_2` | 0 | 09:00-09:05 | On time |
| `SHIFT_2` | 1 | 09:06-09:30 | Late level 1 |
| `SHIFT_2` | 2 | 09:31-10:00 | Late level 2 |
| `SHIFT_2` | 3 | 10:01+ | Late level 3 |
