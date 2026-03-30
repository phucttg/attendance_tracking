import { Badge } from 'flowbite-react';

/**
 * StatusBadge: Centralized status display across all pages.
 * Single source of truth for status → color/label mapping per RULES.md.
 * 
 * Per RULES.md Section 3 & 6:
 * - ON_TIME → green (success)
 * - LATE → orange/red (warning)
 * - WORKING → blue (info)
 * - MISSING_CHECKOUT → yellow (warning)
 * - ABSENT → red (failure)
 * - WEEKEND_OR_HOLIDAY → grey (gray)
 * - null → context-dependent (future/today/past)
 * 
 * Props:
 *  - status: string|null (attendance status key)
 *  - itemDate?: string (YYYY-MM-DD format, for null status context)
 *  - today?: string (YYYY-MM-DD format, current date in GMT+7)
 */

const STATUS_CONFIG = {
    ON_TIME: { color: 'success', label: 'Đúng giờ' },
    LATE: { color: 'warning', label: 'Đi muộn' },
    LATE_AND_EARLY: { color: 'purple', label: 'Muộn & Về sớm' }, // NEW v2.3
    WORKING: { color: 'info', label: 'Đang làm việc' },
    MISSING_CHECKOUT: { color: 'warning', label: 'Thiếu checkout' },
    MISSING_CHECKIN: { color: 'failure', label: 'Thiếu checkin' }, // Edge case
    UNREGISTERED: { color: 'warning', label: 'Chưa đăng ký ca' },
    ABSENT: { color: 'failure', label: 'Vắng mặt' },
    WEEKEND_OR_HOLIDAY: { color: 'gray', label: 'Nghỉ' },
    EARLY_LEAVE: { color: 'warning', label: 'Về sớm' },
};

export default function StatusBadge({ status, itemDate, today }) {
    // Handle null/undefined status based on date context (per RULES.md 3.2)
    if (!status) {
        if (itemDate && today) {
            if (itemDate > today) {
                return <Badge color="gray">Chưa tới</Badge>;
            }
            if (itemDate === today) {
                return <Badge color="gray">Chưa check-in</Badge>;
            }
            return <Badge color="failure">Vắng mặt</Badge>;
        }
        // Default null context (today views) -> not checked in yet
        return <Badge color="gray">Chưa check-in</Badge>;
    }

    const config = STATUS_CONFIG[status] || { color: 'gray', label: status };
    return <Badge color={config.color}>{config.label}</Badge>;
}
