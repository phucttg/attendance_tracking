import { useState, useEffect, useMemo, useCallback } from 'react';
import { Table, Select, Spinner, Alert, Badge } from 'flowbite-react';
import client from '../api/client';
import { getMyRequests } from '../api/requestApi';
import { PageHeader, ScheduleBadge, StatusBadge } from '../components/ui';
import { formatDurationByMode } from '../utils/dateTimeFormat';

/**
 * MyAttendancePage: Monthly attendance history table with status badges.
 *
 * Features:
 * - Month selector (default: current month)
 * - Table with: date, check-in, check-out, status, late, work, OT
 * - Color-coded status badges
 */
export default function MyAttendancePage() {
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [durationModeByCell, setDurationModeByCell] = useState({});
    // Map of YYYY-MM-DD -> OT request object (most recent per date)
    const [otRequestsByDate, setOtRequestsByDate] = useState({});

    // Get current month in GMT+7
    const today = new Date().toLocaleDateString('sv-SE', {
        timeZone: 'Asia/Ho_Chi_Minh',
    });
    const [selectedMonth, setSelectedMonth] = useState(today.slice(0, 7));

    // Generate months for selector (last 12 months) based on GMT+7
    const monthOptions = useMemo(() => {
        const options = [];
        // Parse today GMT+7 as base
        const [year, month] = today.split('-').map(Number);
        for (let i = 0; i < 12; i++) {
            const d = new Date(year, month - 1 - i, 1);
            // Format YYYY-MM using local year/month (NOT toISOString which is UTC)
            const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            const label = d.toLocaleDateString('vi-VN', {
                year: 'numeric',
                month: 'long',
            });
            options.push({ value, label });
        }
        return options;
    }, [today]);

    // Fetch attendance data when month changes (with AbortController)
    const fetchAttendance = useCallback(async (signal) => {
        setLoading(true);
        setError('');
        try {
            const config = signal ? { signal } : undefined;
            const res = await client.get(`/attendance/me?month=${selectedMonth}`, config);
            // Defensive: ensure items is array
            setItems(Array.isArray(res.data?.items) ? res.data.items : []);
        } catch (err) {
            // Ignore abort errors
            if (err.name === 'CanceledError' || err.name === 'AbortError' || err?.code === 'ERR_CANCELED') return;
            setError(err.response?.data?.message || 'Failed to load attendance');
        } finally {
            // Guard: don't setState after abort/unmount
            if (signal?.aborted) return;
            setLoading(false);
        }
    }, [selectedMonth]);

    // Effect with cleanup
    useEffect(() => {
        const controller = new AbortController();
        fetchAttendance(controller.signal);
        return () => controller.abort();
    }, [fetchAttendance]);

    /**
     * Fetch all OT requests for the selected month by paginating through
     * GET /requests/me (limit=100, hard cap=50 pages).
     * Builds a date map where first-seen entry wins (descending createdAt → newest).
     */
    const fetchOtRequests = useCallback(async (signal) => {
        const PAGE_LIMIT = 100;
        const PAGE_CAP = 50;
        const map = {};
        try {
            for (let page = 1; page <= PAGE_CAP; page++) {
                if (signal?.aborted) return;
                const res = await getMyRequests(
                    { page, limit: PAGE_LIMIT },
                    { signal }
                );
                const { items: reqItems = [], pagination = {} } = res.data ?? {};
                for (const req of reqItems) {
                    if (
                        req.type === 'OT_REQUEST' &&
                        typeof req.date === 'string' &&
                        req.date.startsWith(selectedMonth)
                    ) {
                        // First seen = newest (API sorts by createdAt desc)
                        if (!map[req.date]) map[req.date] = req;
                    }
                }
                if (page >= (pagination.totalPages ?? 1)) break;
            }
            if (signal?.aborted) return;
            setOtRequestsByDate(map);
        } catch (err) {
            if (err.name === 'CanceledError' || err.name === 'AbortError' || err?.code === 'ERR_CANCELED') return;
            // Non-blocking: attendance table still renders
            console.warn('[MyAttendancePage] OT request fetch failed:', err);
            if (!signal?.aborted) setOtRequestsByDate({});
        }
    }, [selectedMonth]);

    // Reload OT requests whenever selectedMonth changes
    useEffect(() => {
        const controller = new AbortController();
        fetchOtRequests(controller.signal);
        return () => controller.abort();
    }, [fetchOtRequests]);

    // Format time for display (GMT+7)
    const formatTime = (isoString) => {
        if (!isoString) return '--:--';
        return new Date(isoString).toLocaleTimeString('vi-VN', {
            timeZone: 'Asia/Ho_Chi_Minh',
            hour: '2-digit',
            minute: '2-digit',
        });
    };

    // Format date for display (timezone-safe: always render GMT+7 calendar date)
    const formatDate = (dateStr) => {
        const date = new Date(dateStr + 'T00:00:00+07:00');
        return date.toLocaleDateString('vi-VN', {
            timeZone: 'Asia/Ho_Chi_Minh',
            weekday: 'short',
            day: '2-digit',
            month: '2-digit',
        });
    };

    /** Map OT request status → Flowbite color + Vietnamese label */
    const OT_STATUS_MAP = {
        APPROVED: { color: 'success', label: 'Đã duyệt' },
        PENDING: { color: 'warning', label: 'Chờ duyệt' },
        REJECTED: { color: 'failure', label: 'Từ chối' },
    };

    const getOtBadgeProps = (status) =>
        OT_STATUS_MAP[status] ?? { color: 'gray', label: status ?? '' };

    const getCellKey = (date, metric) => `${date}:${metric}`;
    const getCellMode = (date, metric) => durationModeByCell[getCellKey(date, metric)] || 'minutes';
    const toggleCellMode = (date, metric) => {
        const key = getCellKey(date, metric);
        setDurationModeByCell((prev) => ({
            ...prev,
            [key]: prev[key] === 'hours' ? 'minutes' : 'hours',
        }));
    };
    return (
        <div>
            <PageHeader title="Lịch sử chấm công">
                <Select
                    value={selectedMonth}
                    onChange={(e) => setSelectedMonth(e.target.value)}
                    className="w-48"
                    aria-label="Chọn tháng xem lịch sử chấm công"
                >
                    {monthOptions.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                            {opt.label}
                        </option>
                    ))}
                </Select>
            </PageHeader>

            {/* Error Alert */}
            {error && (
                <Alert color="failure" className="mb-4" onDismiss={() => setError('')}>
                    {error}
                </Alert>
            )}

            {/* Attendance Table */}
            <div className="overflow-x-auto">
                {loading ? (
                    <div className="flex justify-center py-12">
                        <Spinner size="lg" />
                    </div>
                ) : items.length === 0 ? (
                    <div className="text-center py-12 text-gray-500">
                        Không có dữ liệu chấm công trong tháng này
                    </div>
                ) : (
                    <Table striped>
                        <Table.Head>
                            <Table.HeadCell>Ngày</Table.HeadCell>
                            <Table.HeadCell>Check-in</Table.HeadCell>
                            <Table.HeadCell>Check-out</Table.HeadCell>
                            <Table.HeadCell>Trạng thái</Table.HeadCell>
                            <Table.HeadCell>Ca</Table.HeadCell>
                            <Table.HeadCell>Đi muộn</Table.HeadCell>
                            <Table.HeadCell>Làm việc</Table.HeadCell>
                            <Table.HeadCell>OT</Table.HeadCell>
                        </Table.Head>
                        <Table.Body className="divide-y">
                            {items.map((item) => (
                                <Table.Row key={item.date} className="bg-white">
                                    <Table.Cell className="font-medium">
                                        {formatDate(item.date)}
                                    </Table.Cell>
                                    <Table.Cell>{formatTime(item.checkInAt)}</Table.Cell>
                                    <Table.Cell>{formatTime(item.checkOutAt)}</Table.Cell>
                                    <Table.Cell>
                                        <StatusBadge status={item.status} itemDate={item.date} today={today} />
                                    </Table.Cell>
                                    <Table.Cell>
                                        <ScheduleBadge scheduleType={item.scheduleType} />
                                    </Table.Cell>
                                    <Table.Cell>
                                        {item.scheduleType === 'FLEXIBLE' ? (
                                            <span className="text-gray-400">-</span>
                                        ) : item.lateMinutes > 0 ? (
                                            <button
                                                type="button"
                                                className="text-yellow-600 cursor-pointer hover:underline underline-offset-2"
                                                title="Bấm để đổi đơn vị"
                                                aria-label={`Đổi đơn vị đi muộn ngày ${item.date}`}
                                                aria-pressed={getCellMode(item.date, 'late') === 'hours'}
                                                onClick={() => toggleCellMode(item.date, 'late')}
                                            >
                                                {formatDurationByMode(item.lateMinutes, getCellMode(item.date, 'late'))}
                                            </button>
                                        ) : (
                                            <span className="text-gray-400">-</span>
                                        )}
                                    </Table.Cell>
                                    <Table.Cell>
                                        {item.workMinutes > 0 ? (
                                            <button
                                                type="button"
                                                className="cursor-pointer hover:underline underline-offset-2"
                                                title="Bấm để đổi đơn vị"
                                                aria-label={`Đổi đơn vị làm việc ngày ${item.date}`}
                                                aria-pressed={getCellMode(item.date, 'work') === 'hours'}
                                                onClick={() => toggleCellMode(item.date, 'work')}
                                            >
                                                {formatDurationByMode(item.workMinutes, getCellMode(item.date, 'work'))}
                                            </button>
                                        ) : (
                                            <span className="text-gray-400">-</span>
                                        )}
                                    </Table.Cell>
                                    <Table.Cell>
                                        {(() => {
                                            const otReq = otRequestsByDate[item.date];
                                            const hasMinutes = item.otMinutes > 0;
                                            if (!hasMinutes && !otReq) {
                                                return <span className="text-gray-400">-</span>;
                                            }
                                            const { color, label } = otReq
                                                ? getOtBadgeProps(otReq.status)
                                                : {};
                                            return (
                                                <span className="flex flex-wrap items-center gap-1">
                                                    {hasMinutes && (
                                                        <button
                                                            type="button"
                                                            className="text-green-600 cursor-pointer hover:underline underline-offset-2"
                                                            title="Bấm để đổi đơn vị"
                                                            aria-label={`Đổi đơn vị OT ngày ${item.date}`}
                                                            aria-pressed={getCellMode(item.date, 'ot') === 'hours'}
                                                            onClick={() => toggleCellMode(item.date, 'ot')}
                                                        >
                                                            {formatDurationByMode(item.otMinutes, getCellMode(item.date, 'ot'))}
                                                        </button>
                                                    )}
                                                    {otReq && (
                                                        <Badge color={color} data-testid="ot-request-badge">
                                                            {label}
                                                        </Badge>
                                                    )}
                                                </span>
                                            );
                                        })()}
                                    </Table.Cell>
                                </Table.Row>
                            ))}
                        </Table.Body>
                    </Table>
                )}
            </div>
        </div>
    );
}
