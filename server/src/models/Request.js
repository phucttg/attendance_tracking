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
    actualOtMinutes: {
      type: Number,
      default: null  // Filled after checkout for tracking
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
    this.actualOtMinutes = null;
    
    // P1 Fix: Clear LEAVE-specific fields
    this.leaveStartDate = null;
    this.leaveEndDate = null;
    this.leaveType = null;
    this.leaveDaysCount = null;
    
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
  
  // OT_REQUEST: Validate + clear cross-contamination (P0-2 fix)
  if (this.type === 'OT_REQUEST') {
    // P0-2: Clear ADJUST_TIME-specific fields to prevent index pollution
    this.checkInDate = null;
    this.checkOutDate = null;
    this.requestedCheckInAt = null;
    this.requestedCheckOutAt = null;
    
    // P0-2: Clear LEAVE-specific fields
    this.leaveStartDate = null;
    this.leaveEndDate = null;
    this.leaveType = null;
    this.leaveDaysCount = null;
    
    // Required field validation
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
    
    // P1-1: Validate estimatedEndTime date relation (same day or immediate next day)
    if (hasValidOtDate && this.estimatedEndTime) {
      // Convert UTC timestamp to business timezone date key
      const estDate = new Date(this.estimatedEndTime.getTime() + BUSINESS_TZ_OFFSET_MS);
      const estDateKey = estDate.toISOString().slice(0, 10);
      const nextDateKey = getNextDateKey(this.date);
      const isSameDay = estDateKey === this.date;
      const isNextDay = estDateKey === nextDateKey;
      
      if (!isSameDay && !isNextDay) {
        this.invalidate(
          'estimatedEndTime',
          `estimatedEndTime must belong to date ${this.date} or ${nextDateKey} (GMT+${BUSINESS_TZ_OFFSET_HOURS})`
        );
        return;
      }
      
      // P1-2: Validate OT business rules (B1 requirement from docs/rules.md §10.10)
      const estTime = new Date(this.estimatedEndTime.getTime() + BUSINESS_TZ_OFFSET_MS);
      const estHours = estTime.getUTCHours();
      const estMinutes = estTime.getUTCMinutes();
      
      // Convert to minutes since midnight for easier comparison
      const estTotalMinutes = estHours * 60 + estMinutes;
      const otStartMinutes = OT_START_TIME_HOURS * 60 + OT_START_TIME_MINUTES;  // 17:31 = 1051 min
      const minOtEndMinutes = otStartMinutes + OT_MIN_DURATION_MINUTES;  // 17:31 + 30 = 18:01 = 1081 min
      const crossMidnightCutoffMinutes =
        OT_CROSS_MIDNIGHT_CUTOFF_HOURS * 60 + OT_CROSS_MIDNIGHT_CUTOFF_MINUTES; // 08:00 = 480 min

      // Cross-midnight branch: only allow next-day end time in 00:00-07:59
      if (isNextDay) {
        if (estTotalMinutes >= crossMidnightCutoffMinutes) {
          this.invalidate(
            'estimatedEndTime',
            'Cross-midnight OT only supports next-day end time from 00:00 to 07:59 (GMT+7)'
          );
        }
        return;
      }
      
      if (estTotalMinutes < minOtEndMinutes) {
        this.invalidate(
          'estimatedEndTime',
          `OT must end at least ${OT_MIN_DURATION_MINUTES} minutes after ${OT_START_TIME_HOURS}:${OT_START_TIME_MINUTES.toString().padStart(2, '0')} ` +
          `(minimum end time: ${Math.floor(minOtEndMinutes/60)}:${(minOtEndMinutes%60).toString().padStart(2, '0')})`
        );
      }
    }
  }
  
  // P0-2: LEAVE type - clear cross-contamination fields
  if (this.type === 'LEAVE') {
    // Clear ADJUST_TIME-specific fields
    this.date = null;
    this.checkInDate = null;
    this.checkOutDate = null;
    this.requestedCheckInAt = null;
    this.requestedCheckOutAt = null;
    
    // Clear OT_REQUEST-specific fields
    this.estimatedEndTime = null;
    this.actualOtMinutes = null;

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

export { REQUEST_TYPES, REQUEST_STATUSES };
export default mongoose.model('Request', requestSchema);
