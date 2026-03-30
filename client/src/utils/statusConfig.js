/**
 * Status Configuration
 * 
 * Single source of truth for attendance status → color/label mapping.
 * Extracted from AdminMembersPage.jsx and AdminMemberDetailPage.jsx.
 * 
 * Per RULES.md Section 3 & 6:
 * - ON_TIME → green (success badge)
 * - LATE → orange/red (warning badge)
 * - WORKING → blue (info badge)
 * - MISSING_CHECKOUT → yellow (warning badge)
 * - ABSENT → red (failure badge)
 * - WEEKEND_OR_HOLIDAY → grey (gray badge)
 * - null → context-dependent fallback (gray)
 */

// Status → Badge color mapping (per RULES.md)
export const STATUS_COLORS = {
    'ON_TIME': 'success',
    'LATE': 'warning',
    'WORKING': 'info',
    'MISSING_CHECKOUT': 'warning',
    'UNREGISTERED': 'warning',
    'WEEKEND_OR_HOLIDAY': 'gray',
    'ABSENT': 'failure',
    null: 'gray'
};

// Status → Display label mapping
export const STATUS_LABELS = {
    'ON_TIME': 'On Time',
    'LATE': 'Late',
    'WORKING': 'Working',
    'MISSING_CHECKOUT': 'Missing Checkout',
    'UNREGISTERED': 'Unregistered',
    'WEEKEND_OR_HOLIDAY': 'Weekend/Holiday',
    'ABSENT': 'Absent',
    null: '-'
};
