import { useState, useEffect, useCallback } from 'react';
import { Card, Button, Badge, Spinner, Alert } from 'flowbite-react';
import { HiClock, HiCheckCircle, HiXCircle } from 'react-icons/hi';
import { Link, useNavigate } from 'react-router-dom';
import client from '../api/client';
import { ScheduleBadge } from '../components/ui';
import { formatDurationByMode } from '../utils/dateTimeFormat';

const ATTENDANCE_SOURCE = {
    TODAY: 'TODAY',
    CROSS_MIDNIGHT_APPROVED_OT: 'CROSS_MIDNIGHT_APPROVED_OT',
};

const isAbortError = (err) =>
    err?.name === 'CanceledError' || err?.name === 'AbortError' || err?.code === 'ERR_CANCELED';

/**
 * DashboardPage: Main page showing today's attendance status + check-in/out buttons.
 *
 * Features:
 * - Display today's date (GMT+7)
 * - Show status: NOT_CHECKED_IN / WORKING / DONE
 * - Check-in button (enabled when not checked in)
 * - Check-out button (enabled when working)
 * - Display check-in/out times when available
 */
export default function DashboardPage() {
    const navigate = useNavigate();
    const [effectiveAttendance, setEffectiveAttendance] = useState(null);
    const [attendanceSource, setAttendanceSource] = useState(null);
    const [requiresScheduleSelection, setRequiresScheduleSelection] = useState(false);
    const [durationModes, setDurationModes] = useState({
        late: 'minutes',
        work: 'minutes',
        ot: 'minutes',
    });
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState(false);
    const [error, setError] = useState('');
    const [successMessage, setSuccessMessage] = useState('');

    // Get today in GMT+7 format "YYYY-MM-DD"
    const today = new Date().toLocaleDateString('sv-SE', {
        timeZone: 'Asia/Ho_Chi_Minh',
    });

    const currentMonth = today.slice(0, 7); // "YYYY-MM"

    const findAttendanceByDate = useCallback((items, dateKey) => {
        if (!Array.isArray(items)) return null;
        return items.find((item) => item?.date === dateKey) || null;
    }, []);

    const fetchMonthlyAttendance = useCallback(async (month, signal) => {
        const config = signal ? { signal } : undefined;
        const res = await client.get(`/attendance/me?month=${month}`, config);
        return Array.isArray(res.data?.items) ? res.data.items : [];
    }, []);

    // Fetch attendance with AbortController to avoid race conditions
    // showLoading: true for initial load (show spinner), false for action refetch (no spinner)
    const fetchDashboardAttendance = useCallback(async (signal, showLoading = true) => {
        if (showLoading) setLoading(true);
        setError('');
        try {
            const currentMonthItems = await fetchMonthlyAttendance(currentMonth, signal);
            const todayRecord = findAttendanceByDate(currentMonthItems, today);

            let nextEffectiveAttendance = todayRecord || null;
            let nextAttendanceSource = todayRecord ? ATTENDANCE_SOURCE.TODAY : null;
            let nextRequiresScheduleSelection = false;

            const hasTodayCheckIn = Boolean(todayRecord?.checkInAt);
            const hasTodayCheckOut = Boolean(todayRecord?.checkOutAt);
            const shouldCheckOpenSession = Boolean(todayRecord) && !hasTodayCheckIn && !hasTodayCheckOut;

            if (shouldCheckOpenSession) {
                try {
                    const config = signal ? { signal } : undefined;
                    const scheduleRes = await client.get('/work-schedules/me', config);
                    const scheduleItems = Array.isArray(scheduleRes.data?.items) ? scheduleRes.data.items : [];
                    const todaySchedule = scheduleItems.find((item) => item?.workDate === today) || null;
                    nextRequiresScheduleSelection = Boolean(todaySchedule?.isWorkday && !todaySchedule?.scheduleType);
                } catch (scheduleErr) {
                    if (isAbortError(scheduleErr)) return;
                    // Soft-fail: fallback to existing behavior when schedule API is unavailable.
                }
            }

            if (shouldCheckOpenSession) {
                const config = signal ? { signal } : undefined;
                try {
                    const openSessionRes = await client.get('/attendance/open-session', config);
                    const openSession = openSessionRes.data?.openSession || null;
                    const isPreviousDayOpenSession =
                        typeof openSession?.date === 'string' &&
                        openSession.date < today &&
                        Boolean(openSession?.checkInAt);

                    if (isPreviousDayOpenSession) {
                        let openSessionAttendance = findAttendanceByDate(currentMonthItems, openSession.date);

                        if (!openSessionAttendance) {
                            const openSessionMonth = openSession.date.slice(0, 7);
                            if (openSessionMonth !== currentMonth) {
                                try {
                                    const openSessionMonthItems = await fetchMonthlyAttendance(openSessionMonth, signal);
                                    openSessionAttendance = findAttendanceByDate(openSessionMonthItems, openSession.date);
                                } catch (openMonthErr) {
                                    if (isAbortError(openMonthErr)) return;
                                }
                            }
                        }

                        if (openSessionAttendance?.otApproved === true && !openSessionAttendance?.checkOutAt) {
                            nextEffectiveAttendance = {
                                ...openSessionAttendance,
                                checkInAt: openSession.checkInAt || openSessionAttendance.checkInAt,
                                checkOutAt: null,
                            };
                            nextAttendanceSource = ATTENDANCE_SOURCE.CROSS_MIDNIGHT_APPROVED_OT;
                        }
                    }
                } catch (openSessionErr) {
                    if (isAbortError(openSessionErr)) return;
                    // Fallback to default today-only behavior.
                }
            }

            setEffectiveAttendance(nextEffectiveAttendance);
            setAttendanceSource(nextAttendanceSource);
            setRequiresScheduleSelection(nextRequiresScheduleSelection);
        } catch (err) {
            // Ignore abort errors
            if (isAbortError(err)) return;
            setError(err.response?.data?.message || 'Failed to load attendance');
        } finally {
            // Guard: don't setState after abort/unmount
            if (signal?.aborted) return;
            if (showLoading) setLoading(false);
        }
    }, [currentMonth, today, fetchMonthlyAttendance, findAttendanceByDate]);

    // Fetch on mount with cleanup
    useEffect(() => {
        const controller = new AbortController();
        fetchDashboardAttendance(controller.signal, true);
        return () => controller.abort();
    }, [fetchDashboardAttendance]);

    const handleCheckIn = async () => {
        setActionLoading(true);
        setError('');
        setSuccessMessage('');
        try {
            await client.post('/attendance/check-in');
            // Refetch without showing spinner (smooth UX)
            await fetchDashboardAttendance(undefined, false);
        } catch (err) {
            const code = err.response?.data?.code;
            if (code === 'SCHEDULE_REQUIRED') {
                navigate(err.response?.data?.redirectTo || '/my-schedule');
                return;
            }
            setError(err.response?.data?.message || 'Check-in failed');
        } finally {
            setActionLoading(false);
        }
    };

    const handleCheckOut = async () => {
        setActionLoading(true);
        setError('');
        setSuccessMessage('');
        const isCrossMidnightApprovedOt = attendanceSource === ATTENDANCE_SOURCE.CROSS_MIDNIGHT_APPROVED_OT;
        try {
            await client.post('/attendance/check-out');
            if (isCrossMidnightApprovedOt) {
                setSuccessMessage('Đã check-out ca OT ngày trước');
            }
            // Refetch without showing spinner (smooth UX)
            await fetchDashboardAttendance(undefined, false);
        } catch (err) {
            setError(err.response?.data?.message || 'Check-out failed');
        } finally {
            setActionLoading(false);
        }
    };

    const toggleDurationMode = (metric) => {
        setDurationModes((prev) => ({
            ...prev,
            [metric]: prev[metric] === 'minutes' ? 'hours' : 'minutes',
        }));
    };

    // Determine display state
    const hasCheckedIn = Boolean(effectiveAttendance?.checkInAt);
    const hasCheckedOut = Boolean(effectiveAttendance?.checkOutAt);
    const isUnregisteredToday = effectiveAttendance?.status === 'UNREGISTERED';
    const shouldPromptScheduleRegistration = !hasCheckedIn && (isUnregisteredToday || requiresScheduleSelection);
    const isFlexible = effectiveAttendance?.scheduleType === 'FLEXIBLE';
    const lateMinutes = Number.isFinite(effectiveAttendance?.lateMinutes) ? effectiveAttendance.lateMinutes : 0;
    const workMinutes = Number.isFinite(effectiveAttendance?.workMinutes) ? effectiveAttendance.workMinutes : 0;
    const otMinutes = Number.isFinite(effectiveAttendance?.otMinutes) ? effectiveAttendance.otMinutes : 0;

    // Format time for display (GMT+7)
    const formatTime = (isoString) => {
        if (!isoString) return '--:--';
        return new Date(isoString).toLocaleTimeString('vi-VN', {
            timeZone: 'Asia/Ho_Chi_Minh',
            hour: '2-digit',
            minute: '2-digit',
        });
    };

    // Format date for display
    const formatDate = (dateStr) => {
        const date = new Date(dateStr + 'T00:00:00+07:00');
        return date.toLocaleDateString('vi-VN', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            timeZone: 'Asia/Ho_Chi_Minh',
        });
    };

    return (
        <div className="max-w-xl mx-auto">
            {/* Page Title */}
            <h1 className="text-2xl font-bold text-gray-900 mb-6">Dashboard</h1>

            {/* Today's Date Card */}
            <Card className="mb-6 shadow-sm">
                <div className="text-center">
                    <p className="text-gray-500 text-sm">Hôm nay</p>
                    <p className="text-lg font-semibold text-gray-800">
                        {formatDate(today)}
                    </p>
                </div>
            </Card>

            {/* Error Alert */}
            {successMessage && (
                <Alert color="success" className="mb-4" onDismiss={() => setSuccessMessage('')}>
                    {successMessage}
                </Alert>
            )}
            {error && (
                <Alert color="failure" className="mb-4" onDismiss={() => setError('')}>
                    {error}
                </Alert>
            )}

            {/* Attendance Status Card */}
            <Card>
                {loading ? (
                    <div className="flex justify-center py-8">
                        <Spinner size="lg" />
                    </div>
                ) : (
                    <div className="text-center space-y-6">
                        {/* Status Badge */}
                        <div>
                            {shouldPromptScheduleRegistration ? (
                                <Badge color="warning" size="lg" icon={HiXCircle}>
                                    Chưa đăng ký ca
                                </Badge>
                            ) : !hasCheckedIn ? (
                                <Badge color="gray" size="lg" icon={HiXCircle}>
                                    Chưa check-in
                                </Badge>
                            ) : !hasCheckedOut ? (
                                <Badge color="success" size="lg" icon={HiClock}>
                                    Đang làm việc
                                </Badge>
                            ) : (
                                <Badge color="info" size="lg" icon={HiCheckCircle}>
                                    Đã check-out
                                </Badge>
                            )}
                        </div>

                        <div className="flex justify-center">
                            <ScheduleBadge scheduleType={effectiveAttendance?.scheduleType} />
                        </div>

                        {/* Check-in/out Times */}
                        <div className="grid grid-cols-2 gap-4 text-sm">
                            <div className="bg-primary-50 rounded-lg p-4 border border-primary-100">
                                <div className="flex items-center gap-2 text-primary-600 text-sm mb-1">
                                    <HiClock className="h-4 w-4" />
                                    <span>Check-in</span>
                                </div>
                                <p className="text-2xl font-bold text-gray-900">
                                    {formatTime(effectiveAttendance?.checkInAt)}
                                </p>
                            </div>
                            <div className="bg-primary-50 rounded-lg p-4 border border-primary-100">
                                <div className="flex items-center gap-2 text-primary-600 text-sm mb-1">
                                    <HiCheckCircle className="h-4 w-4" />
                                    <span>Check-out</span>
                                </div>
                                <p className="text-2xl font-bold text-gray-900">
                                    {formatTime(effectiveAttendance?.checkOutAt)}
                                </p>
                            </div>
                        </div>

                        {/* Late/Work/OT Info (if checked in) */}
                        {hasCheckedIn && (
                            <div className="grid grid-cols-3 gap-2 text-xs">
                                <div className="bg-yellow-50 rounded p-2">
                                    <p className="text-yellow-600">Đi muộn</p>
                                    <p className="font-semibold">
                                        {isFlexible ? (
                                            '-'
                                        ) : (
                                            <button
                                                type="button"
                                                className="cursor-pointer hover:underline underline-offset-2"
                                                title="Bấm để đổi đơn vị"
                                                aria-label="Đổi đơn vị đi muộn"
                                                aria-pressed={durationModes.late === 'hours'}
                                                onClick={() => toggleDurationMode('late')}
                                            >
                                                {formatDurationByMode(lateMinutes, durationModes.late)}
                                            </button>
                                        )}
                                    </p>
                                </div>
                                <div className="bg-blue-50 rounded p-2">
                                    <p className="text-blue-600">Làm việc</p>
                                    <p className="font-semibold">
                                        <button
                                            type="button"
                                            className="cursor-pointer hover:underline underline-offset-2"
                                            title="Bấm để đổi đơn vị"
                                            aria-label="Đổi đơn vị làm việc"
                                            aria-pressed={durationModes.work === 'hours'}
                                            onClick={() => toggleDurationMode('work')}
                                        >
                                            {formatDurationByMode(workMinutes, durationModes.work)}
                                        </button>
                                    </p>
                                </div>
                                <div className="bg-green-50 rounded p-2">
                                    <p className="text-green-600">OT</p>
                                    <p className="font-semibold">
                                        {isFlexible ? (
                                            '-'
                                        ) : (
                                            <button
                                                type="button"
                                                className="cursor-pointer hover:underline underline-offset-2"
                                                title="Bấm để đổi đơn vị"
                                                aria-label="Đổi đơn vị OT"
                                                aria-pressed={durationModes.ot === 'hours'}
                                                onClick={() => toggleDurationMode('ot')}
                                            >
                                                {formatDurationByMode(otMinutes, durationModes.ot)}
                                            </button>
                                        )}
                                    </p>
                                </div>
                            </div>
                        )}

                        {/* Action Buttons */}
                        <div className="flex gap-4 justify-center">
                            {shouldPromptScheduleRegistration ? (
                                <Button as={Link} to="/my-schedule" color="warning">
                                    Đăng ký ca ngay
                                </Button>
                            ) : !hasCheckedIn && (
                                <Button
                                    color="blue"
                                    size="lg"
                                    onClick={handleCheckIn}
                                    disabled={actionLoading || loading}
                                >
                                    {actionLoading ? (
                                        <Spinner size="sm" className="mr-2" />
                                    ) : null}
                                    Check-in
                                </Button>
                            )}
                            {hasCheckedIn && !hasCheckedOut && (
                                <Button
                                    color="failure"
                                    size="lg"
                                    onClick={handleCheckOut}
                                    disabled={actionLoading || loading}
                                >
                                    {actionLoading ? (
                                        <Spinner size="sm" className="mr-2" />
                                    ) : null}
                                    Check-out
                                </Button>
                            )}
                            {hasCheckedOut && (
                                <p className="text-gray-500 italic">
                                    Bạn đã hoàn thành ngày làm việc!
                                </p>
                            )}
                        </div>
                    </div>
                )}
            </Card>
        </div>
    );
}
