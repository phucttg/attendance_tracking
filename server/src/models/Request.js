import mongoose from 'mongoose';

// Business timezone configuration (Asia/Ho_Chi_Minh = GMT+7)
// WARNING: Changing this requires updating all date/time calculations across the system
const BUSINESS_TZ_OFFSET_HOURS = 7;
const BUSINESS_TZ_OFFSET_MS = BUSINESS_TZ_OFFSET_HOURS * 60 * 60 * 1000;

// OT business rules (see docs/rules.md §10)
const OT_START_TIME_HOURS = 17;  // 17:31 in 24h format
const OT_START_TIME_MINUTES = 31;
const OT_MIN_DURATION_MINUTES = 30;  // Minimum OT duration (B1 requirement)
const OT_CROSS_MIDNIGHT_CUTOFF_HOURS = 8;  // 08:00 boundary (exclusive)
const OT_CROSS_MIDNIGHT_CUTOFF_MINUTES = 0;

const REQUEST_TYPES = ['ADJUST_TIME', 'LEAVE', 'OT_REQUEST'];
const REQUEST_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'];
const ADJUST_MODES = ['GENERAL', 'FORGOT_CHECKOUT'];
const OT_MODES = ['CONTINUOUS', 'SEPARATED'];

const getNextDateKey = (dateKey) => {
  const [year, month, day] = dateKey.split('-').map(Number);
  const nextDate = new Date(Date.UTC(year, month - 1, day + 1, 12, 0, 0));
  return nextDate.toISOString().slice(0, 10);
};

const isValidCalendarDate = (dateKey) => {
  if (typeof dateKey !== 'string') {
    return false;
  }

  const match = dateKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));

  return parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day;
};

const getDateKeyInBusinessTz = (date) => {
  if (!(date instanceof Date) || isNaN(date.getTime())) {
    return '';
  }
  const shifted = new Date(date.getTime() + BUSINESS_TZ_OFFSET_MS);
  return shifted.toISOString().slice(0, 10);
};

const getTimePartsInBusinessTz = (date) => {
  if (!(date instanceof Date) || isNaN(date.getTime())) {
    return { hours: -1, minutes: -1, totalMinutes: -1 };
  }
  const shifted = new Date(date.getTime() + BUSINESS_TZ_OFFSET_MS);
  const hours = shifted.getUTCHours();
  const minutes = shifted.getUTCMinutes();
  return { hours, minutes, totalMinutes: hours * 60 + minutes };
};

const requestSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    date: {
      type: String,
      required: function () { 
        return this.type === 'ADJUST_TIME' || this.type === 'OT_REQUEST';
      },
      default: null,
      match: /^\d{4}-\d{2}-\d{2}$/,
      // Backward compatibility: Auto-populated from checkInDate via pre-validate hook
      // Will be deprecated in favor of checkInDate/checkOutDate
    },
    checkInDate: {
      type: String,
      default: null,
      match: /^\d{4}-\d{2}-\d{2}$/,
      // Actual date of check-in (can differ from checkOutDate for cross-midnight)
    },
    checkOutDate: {
      type: String,
      default: null,
      match: /^\d{4}-\d{2}-\d{2}$/,
      // Actual date of check-out (can be > checkInDate for overnight shifts)
    },
    type: {
      type: String,
      enum: REQUEST_TYPES,
      required: true,
      default: 'ADJUST_TIME'
    },
    adjustMode: {
      type: String,
      enum: ADJUST_MODES,
      default: null
    },
    targetAttendanceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Attendance',
      default: null
    },
    requestedCheckInAt: {
      type: Date,
      default: null
    },
    requestedCheckOutAt: {
      type: Date,
      default: null
    },
    leaveStartDate: {
      type: String,
      required: function () { return this.type === 'LEAVE'; },
      default: null,
      match: /^\d{4}-\d{2}-\d{2}$/
    },
    leaveEndDate: {
      type: String,
      required: function () { return this.type === 'LEAVE'; },
      default: null,
      match: /^\d{4}-\d{2}-\d{2}$/
    },
    leaveType: {
      type: String,
      enum: ['ANNUAL', 'SICK', 'UNPAID'],
      default: null
    },
    leaveDaysCount: {
      type: Number,
      default: null
    },
    // NEW: OT Request fields
    estimatedEndTime: {
      type: Date,
      default: null,
      required: function() { return this.type === 'OT_REQUEST'; }
    },
    otMode: {
      type: String,
      enum: OT_MODES,
      default: 'CONTINUOUS'
    },
    otStartTime: {
      type: Date,
      default: null
    },
    actualOtMinutes: {
      type: Number,
      default: null  // Filled after checkout for tracking
    },
    isOtSlotActive: {
      type: Boolean,
      default: false
    },
    reason: {
      type: String,
      required: function() {
        return this.type === 'OT_REQUEST';
      },
      trim: true
    },
    status: {
      type: String,
      enum: REQUEST_STATUSES,
      default: 'PENDING'
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    approvedAt: {
      type: Date
    },
    systemRejectReason: {
      type: String,
      default: null,
      trim: true
    },
    rejectReason: {
      type: String,
      default: null,
      trim: true,
      maxlength: 500
    }
  },
  { timestamps: true }
);

// P0 Fix: Auto-sync date <-> checkInDate for backward compatibility + validate cross-midnight
// Ensures invariant: date === checkInDate for ADJUST_TIME (prevents approve/update bugs)
// P2 Fix: Removed async (no await operations)
requestSchema.pre('validate', function() {
  // ADJUST_TIME: Sync date <-> checkInDate + cross-midnight validation
  if (this.type === 'ADJUST_TIME') {
    // P1 Fix: Clear OT_REQUEST-specific fields to prevent data pollution
    // (symmetric with OT_REQUEST and LEAVE branches)
    this.estimatedEndTime = null;
    this.otMode = null;
    this.otStartTime = null;
    this.actualOtMinutes = null;
    this.isOtSlotActive = false;
    
    // P1 Fix: Clear LEAVE-specific fields
    this.leaveStartDate = null;
    this.leaveEndDate = null;
    this.leaveType = null;
    this.leaveDaysCount = null;

    // Default adjust mode for backward compatibility
    if (!this.adjustMode) {
      this.adjustMode = 'GENERAL';
    }

    if (!ADJUST_MODES.includes(this.adjustMode)) {
      this.invalidate('adjustMode', `adjustMode must be one of: ${ADJUST_MODES.join(', ')}`);
    }

    if (this.adjustMode === 'GENERAL') {
      this.targetAttendanceId = null;
    }

    if (this.adjustMode === 'FORGOT_CHECKOUT' && !this.targetAttendanceId) {
      this.invalidate('targetAttendanceId', 'targetAttendanceId is required for FORGOT_CHECKOUT mode');
    }
    
    // Sync date <-> checkInDate (bidirectional for safety)
    if (this.checkInDate && !this.date) {
      this.date = this.checkInDate;
    }
    if (this.date && !this.checkInDate) {
      this.checkInDate = this.date;
    }

    const hasValidAdjustDate = !this.date || isValidCalendarDate(this.date);
    const hasValidAdjustCheckInDate = !this.checkInDate || isValidCalendarDate(this.checkInDate);
    const hasValidAdjustCheckOutDate = !this.checkOutDate || isValidCalendarDate(this.checkOutDate);

    if (this.date && !hasValidAdjustDate) {
      this.invalidate('date', `Invalid calendar date: ${this.date}`);
    }
    if (this.checkInDate && !hasValidAdjustCheckInDate) {
      this.invalidate('checkInDate', `Invalid calendar date: ${this.checkInDate}`);
    }
    if (this.checkOutDate && !hasValidAdjustCheckOutDate) {
      this.invalidate('checkOutDate', `Invalid calendar date: ${this.checkOutDate}`);
    }

    // P0: Strict invariant enforcement to prevent data inconsistency
    // Without this, approve/updateAttendance will lookup wrong date
    if (this.date && this.checkInDate && this.date !== this.checkInDate) {
      this.invalidate('date', 'date must equal checkInDate for ADJUST_TIME (invariant violation)');
    }

    // Cross-midnight validation: checkOutDate >= checkInDate (string comparison OK for YYYY-MM-DD)
    if (
      this.checkInDate &&
      this.checkOutDate &&
      hasValidAdjustCheckInDate &&
      hasValidAdjustCheckOutDate &&
      this.checkOutDate < this.checkInDate
    ) {
      this.invalidate('checkOutDate', 'checkOutDate must be >= checkInDate for cross-midnight requests');
    }
  }
  
  // OT_REQUEST: Validate + clear cross-contamination (mode-aware)
  if (this.type === 'OT_REQUEST') {
    // Clear ADJUST_TIME-specific fields
    this.checkInDate = null;
    this.checkOutDate = null;
    this.adjustMode = null;
    this.targetAttendanceId = null;
    this.systemRejectReason = null;
    this.requestedCheckInAt = null;
    this.requestedCheckOutAt = null;

    // Clear LEAVE-specific fields
    this.leaveStartDate = null;
    this.leaveEndDate = null;
    this.leaveType = null;
    this.leaveDaysCount = null;

    // Active OT slot lock follows lifecycle states.
    this.isOtSlotActive = this.status === 'PENDING' || this.status === 'APPROVED';

    // Default mode for backward compatibility.
    if (!this.otMode) {
      this.otMode = 'CONTINUOUS';
    }

    if (!OT_MODES.includes(this.otMode)) {
      this.invalidate('otMode', `otMode must be one of: ${OT_MODES.join(', ')}`);
      return;
    }

    // Required field validations
    if (!this.date) {
      this.invalidate('date', 'Date is required for OT_REQUEST');
    }

    const hasValidOtDate = Boolean(this.date) && isValidCalendarDate(this.date);
    if (this.date && !hasValidOtDate) {
      this.invalidate('date', `Invalid calendar date: ${this.date}`);
    }
    
    if (!this.estimatedEndTime) {
      this.invalidate('estimatedEndTime', 'estimatedEndTime is required for OT_REQUEST');
    }
    
    // P0 Fix: Guard against Invalid Date to prevent crash in getTime()/toISOString()
    // Mongoose can cast bad input (e.g., "abc") to Invalid Date object
    if (this.estimatedEndTime && (!(this.estimatedEndTime instanceof Date) || isNaN(this.estimatedEndTime.getTime()))) {
      this.invalidate('estimatedEndTime', 'estimatedEndTime is invalid');
      return; // Stop validation to prevent crash in subsequent code
    }

    if (!hasValidOtDate || !this.estimatedEndTime) {
      return;
    }

    const nextDateKey = getNextDateKey(this.date);
    const thresholdMinutes = OT_START_TIME_HOURS * 60 + OT_START_TIME_MINUTES;
    const minContinuousEndMinutes = thresholdMinutes + OT_MIN_DURATION_MINUTES;
    const crossMidnightCutoffMinutes =
      OT_CROSS_MIDNIGHT_CUTOFF_HOURS * 60 + OT_CROSS_MIDNIGHT_CUTOFF_MINUTES;

    const estimatedDateKey = getDateKeyInBusinessTz(this.estimatedEndTime);
    const estimatedTime = getTimePartsInBusinessTz(this.estimatedEndTime);
    const estimatedIsSameDay = estimatedDateKey === this.date;
    const estimatedIsNextDay = estimatedDateKey === nextDateKey;

    if (!estimatedIsSameDay && !estimatedIsNextDay) {
      this.invalidate(
        'estimatedEndTime',
        `estimatedEndTime must belong to date ${this.date} or ${nextDateKey} (GMT+${BUSINESS_TZ_OFFSET_HOURS})`
      );
      return;
    }

    if (estimatedIsNextDay && estimatedTime.totalMinutes >= crossMidnightCutoffMinutes) {
      this.invalidate(
        'estimatedEndTime',
        'Cross-midnight OT only supports next-day end time from 00:00 to 07:59 (GMT+7)'
      );
      return;
    }

    if (this.otMode === 'CONTINUOUS') {
      this.otStartTime = null;

      if (!estimatedIsNextDay && estimatedTime.totalMinutes < minContinuousEndMinutes) {
        this.invalidate(
          'estimatedEndTime',
          `OT must end at least ${OT_MIN_DURATION_MINUTES} minutes after ${OT_START_TIME_HOURS}:${OT_START_TIME_MINUTES.toString().padStart(2, '0')} ` +
          `(minimum end time: ${Math.floor(minContinuousEndMinutes / 60)}:${(minContinuousEndMinutes % 60).toString().padStart(2, '0')})`
        );
      }
      return;
    }

    // SEPARATED mode
    if (!this.otStartTime) {
      this.invalidate('otStartTime', 'otStartTime is required for SEPARATED OT');
      return;
    }

    if (!(this.otStartTime instanceof Date) || isNaN(this.otStartTime.getTime())) {
      this.invalidate('otStartTime', 'otStartTime is invalid');
      return;
    }

    const otStartDateKey = getDateKeyInBusinessTz(this.otStartTime);
    const otStartParts = getTimePartsInBusinessTz(this.otStartTime);
    const startIsSameDay = otStartDateKey === this.date;
    const startIsNextDay = otStartDateKey === nextDateKey;

    if (!startIsSameDay && !startIsNextDay) {
      this.invalidate(
        'otStartTime',
        `otStartTime must belong to date ${this.date} or ${nextDateKey} (GMT+${BUSINESS_TZ_OFFSET_HOURS})`
      );
      return;
    }

    if (startIsNextDay && otStartParts.totalMinutes >= crossMidnightCutoffMinutes) {
      this.invalidate(
        'otStartTime',
        'Cross-midnight OT start time must be before 08:00 (GMT+7)'
      );
      return;
    }

    const otThreshold = new Date(Date.UTC(
      Number(this.date.slice(0, 4)),
      Number(this.date.slice(5, 7)) - 1,
      Number(this.date.slice(8, 10)),
      OT_START_TIME_HOURS - BUSINESS_TZ_OFFSET_HOURS,
      OT_START_TIME_MINUTES,
      0,
      0
    ));

    if (this.otStartTime <= otThreshold) {
      this.invalidate('otStartTime', 'otStartTime must be after 17:31 (GMT+7)');
      return;
    }

    if (this.estimatedEndTime <= this.otStartTime) {
      this.invalidate('estimatedEndTime', 'estimatedEndTime must be after otStartTime');
      return;
    }

    const separatedDurationMinutes = Math.floor((this.estimatedEndTime - this.otStartTime) / (1000 * 60));
    if (separatedDurationMinutes < OT_MIN_DURATION_MINUTES) {
      this.invalidate(
        'estimatedEndTime',
        `SEPARATED OT must be at least ${OT_MIN_DURATION_MINUTES} minutes`
      );
    }
  }
  
  // P0-2: LEAVE type - clear cross-contamination fields
  if (this.type === 'LEAVE') {
    // Clear ADJUST_TIME-specific fields
    this.date = null;
    this.checkInDate = null;
    this.checkOutDate = null;
    this.adjustMode = null;
    this.targetAttendanceId = null;
    this.systemRejectReason = null;
    this.requestedCheckInAt = null;
    this.requestedCheckOutAt = null;
    
    // Clear OT_REQUEST-specific fields
    this.estimatedEndTime = null;
    this.otMode = null;
    this.otStartTime = null;
    this.actualOtMinutes = null;
    this.isOtSlotActive = false;

    const hasValidLeaveStartDate = !this.leaveStartDate || isValidCalendarDate(this.leaveStartDate);
    const hasValidLeaveEndDate = !this.leaveEndDate || isValidCalendarDate(this.leaveEndDate);

    if (this.leaveStartDate && !hasValidLeaveStartDate) {
      this.invalidate('leaveStartDate', `Invalid calendar date: ${this.leaveStartDate}`);
    }
    if (this.leaveEndDate && !hasValidLeaveEndDate) {
      this.invalidate('leaveEndDate', `Invalid calendar date: ${this.leaveEndDate}`);
    }
    
    // P1-2: LEAVE date range validation
    if (
      this.leaveStartDate &&
      this.leaveEndDate &&
      hasValidLeaveStartDate &&
      hasValidLeaveEndDate
    ) {
      if (this.leaveEndDate < this.leaveStartDate) {
        this.invalidate(
          'leaveEndDate',
          'leaveEndDate must be >= leaveStartDate'
        );
      }
    }
  }
});

// Efficient querying for user's requests and status filtering
requestSchema.index({ userId: 1, status: 1 });
// Approval history sorting (newest processed first)
requestSchema.index({ status: 1, approvedAt: -1 });
requestSchema.index({ userId: 1, status: 1, approvedAt: -1 });

// P2 Fix: Unique index now uses checkInDate (primary key for cross-midnight)
// Prevents duplicate PENDING requests for same (userId, checkInDate, type)
// Guards against race conditions + ensures data integrity with new schema
// P0-3 Fix: Removed $type filter (field invariant ensures checkInDate exists for ADJUST_TIME)
requestSchema.index(
  { userId: 1, checkInDate: 1, type: 1 },
  {
    unique: true,
    partialFilterExpression: { 
      status: 'PENDING', 
      type: 'ADJUST_TIME'
    }
  }
);

// Performance index for LEAVE overlap queries (check by userId, type, status)
requestSchema.index({ userId: 1, type: 1, status: 1 });

// P2 Fix: Cross-midnight indexes with userId prefix + partial filter
// Most queries are user-scoped (GET /requests/me, manager approval by team)
// Partial filter prevents index bloat from LEAVE docs (checkInDate/checkOutDate = null)
// P0-3 Fix: Removed $type filters (MongoDB naturally excludes null values from indexes)
requestSchema.index(
  { userId: 1, checkInDate: 1, status: 1 },
  { partialFilterExpression: { type: 'ADJUST_TIME' } }
);
requestSchema.index(
  { userId: 1, checkOutDate: 1, status: 1 },
  { partialFilterExpression: { type: 'ADJUST_TIME' } }
);

// NEW: Unique index for OT_REQUEST
// Ensures max 1 PENDING OT request per (userId, date)
// Enables auto-extend feature (D2 requirement)
// P0-3 Fix: Removed $type filter (date field is always string when OT_REQUEST)
requestSchema.index(
  { userId: 1, date: 1, type: 1 },
  {
    unique: true,
    partialFilterExpression: { 
      status: 'PENDING', 
      type: 'OT_REQUEST'
    }
  }
);

// New: Active OT slot uniqueness (PENDING or APPROVED).
// Kept alongside legacy pending index during rollout/stabilization.
requestSchema.index(
  { userId: 1, date: 1, type: 1, isOtSlotActive: 1 },
  {
    unique: true,
    partialFilterExpression: {
      type: 'OT_REQUEST',
      isOtSlotActive: true
    }
  }
);

export { REQUEST_TYPES, REQUEST_STATUSES, ADJUST_MODES, OT_MODES };
export default mongoose.model('Request', requestSchema);
