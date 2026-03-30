import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
    Card, Table, Button, Spinner, Alert, Badge, Select, Label
} from 'flowbite-react';
import { HiArrowLeft } from 'react-icons/hi';
import {
    getTeams, getUserAttendance, getUserById, getUserWorkSchedules
} from '../api/memberApi';
import { ScheduleBadge } from '../components/ui';

/**
 * TeamMemberDetailPage: Manager views same-team member profile + monthly attendance.
 * 
 * Features:
 * - Profile card with user info (read-only)
 * - Monthly attendance table with month picker
 * - NO Edit/Reset buttons (Manager cannot modify members)
 * - 403 handling for other-team access (Anti-IDOR)
 * 
 * RBAC: MANAGER only (enforced by route + backend)
 */
export default function TeamMemberDetailPage() {
    const { id } = useParams();
    const navigate = useNavigate();
    const isMounted = useRef(true);

    // Get current month in YYYY-MM format (GMT+7) - Portable across browsers
    const getCurrentMonth = () => {
        // Use UTC + offset instead of toLocaleString parse (more portable)
        const now = new Date();
        const utcMs = now.getTime() + (now.getTimezoneOffset() * 60000);
        const gmt7Ms = utcMs + (7 * 60 * 60 * 1000); // +7 hours
        const gmt7 = new Date(gmt7Ms);
        return `${gmt7.getFullYear()}-${String(gmt7.getMonth() + 1).padStart(2, '0')}`;
    };

    // Data states
    const [user, setUser] = useState(null);
    const [attendance, setAttendance] = useState([]);
    const [teams, setTeams] = useState([]);
    const [teamsLoading, setTeamsLoading] = useState(true); // Track teams directory loading
    const [month, setMonth] = useState(getCurrentMonth());
    const [loading, setLoading] = useState(true);
    const [attendanceLoading, setAttendanceLoading] = useState(false);
    const [attendanceError, setAttendanceError] = useState('');
    const [scheduleWindow, setScheduleWindow] = useState([]);
    const [scheduleError, setScheduleError] = useState('');
    const [error, setError] = useState('');

    // Race condition protection
    const attendanceRequestIdRef = useRef(0);

    // Status badge colors per RULES.md line 102-109
    const statusColors = {
        'ON_TIME': 'success',      // green
        'LATE': 'warning',         // orange/red → Flowbite warning is orange
        'WORKING': 'info',         // blue
        'MISSING_CHECKOUT': 'warning', // yellow per RULES.md
        'WEEKEND_OR_HOLIDAY': 'gray',  // grey per RULES.md
        'UNREGISTERED': 'warning',
        'ABSENT': 'failure',           // red
        null: 'gray'                   // neutral
    };

    const statusLabels = {
        'ON_TIME': 'On Time',
        'LATE': 'Late',
        'WORKING': 'Working',
        'MISSING_CHECKOUT': 'Missing Checkout',
        'WEEKEND_OR_HOLIDAY': 'Weekend/Holiday',
        'UNREGISTERED': 'Unregistered',
        'ABSENT': 'Absent',
        null: '-'
    };

    // Cleanup on unmount
    useEffect(() => {
        isMounted.current = true;
        return () => {
            isMounted.current = false;
        };
    }, []);

    // Fetch teams for display
    useEffect(() => {
        const fetchTeamsList = async () => {
            setTeamsLoading(true);
            try {
                const res = await getTeams();
                if (isMounted.current) setTeams(res.data.items || []);
            } catch (err) {
                console.error('Failed to fetch teams:', err);
            } finally {
                if (isMounted.current) setTeamsLoading(false);
            }
        };
        fetchTeamsList();
    }, []);

    // Fetch user profile on mount
    useEffect(() => {
        const fetchUser = async () => {
            setLoading(true);
            setError('');
            try {
                const res = await getUserById(id);
                if (isMounted.current) setUser(res.data.user);
            } catch (err) {
                if (isMounted.current) {
                    // Handle 403 (other team) vs 404 (not found)
                    if (err.response?.status === 403) {
                        setError('You do not have access to this member');
                    } else if (err.response?.status === 404) {
                        setError('Member not found');
                    } else {
                        setError(err.response?.data?.message || 'Failed to load member');
                    }
                }
            } finally {
                if (isMounted.current) setLoading(false);
            }
        };
        if (id) fetchUser();
    }, [id]);

    // Fetch attendance when month changes (with race condition protection)
    // FIX: Skip if profile loading or already has error (avoid race with profile fetch)
    const fetchAttendance = useCallback(async () => {
        if (!id || !month || loading || error) return; // Skip if profile loading/errored

        const currentRequestId = ++attendanceRequestIdRef.current;

        setAttendanceLoading(true);
        setAttendanceError('');
        try {
            const res = await getUserAttendance(id, month);
            if (isMounted.current && currentRequestId === attendanceRequestIdRef.current) {
                setAttendance(res.data.items || []);
            }
        } catch (err) {
            console.error('Failed to fetch attendance:', err);
            if (isMounted.current && currentRequestId === attendanceRequestIdRef.current) {
                setAttendance([]);
                // 403 on attendance means other-team (should have failed on user already)
                if (err.response?.status === 403) {
                    setAttendanceError('You do not have access to this member\'s attendance');
                } else {
                    setAttendanceError(err.response?.data?.message || 'Failed to load attendance');
                }
            }
        } finally {
            if (isMounted.current && currentRequestId === attendanceRequestIdRef.current) {
                setAttendanceLoading(false);
            }
        }
    }, [id, month, loading, error]); // Add loading and error to deps

    useEffect(() => {
        fetchAttendance();
    }, [fetchAttendance]);

    useEffect(() => {
        const fetchScheduleWindow = async () => {
            if (!id) return;
            setScheduleError('');
            try {
                const res = await getUserWorkSchedules(id);
                if (isMounted.current) {
                    setScheduleWindow(Array.isArray(res.data?.items) ? res.data.items : []);
                }
            } catch (err) {
                if (isMounted.current) {
                    setScheduleWindow([]);
                    setScheduleError(err.response?.data?.message || 'Failed to load work schedule');
                }
            }
        };
        fetchScheduleWindow();
    }, [id]);

    // Format date (YYYY-MM-DD → dd/mm/yyyy)
    const formatDate = (dateStr) => {
        if (!dateStr) return '-';
        const [year, month, day] = dateStr.split('-');
        return `${day}/${month}/${year}`;
    };

    // Format time (ISO → HH:mm GMT+7)
    const formatTime = (isoString) => {
        if (!isoString) return '-';
        return new Date(isoString).toLocaleTimeString('vi-VN', {
            timeZone: 'Asia/Ho_Chi_Minh',
            hour: '2-digit',
            minute: '2-digit',
        });
    };

    // Format minutes to hours
    const formatMinutes = (minutes) => {
        if (minutes === null || minutes === undefined) return '-';
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
    };

    // Generate month options (last 12 months) - Use GMT+7 for consistency
    const getMonthOptions = () => {
        const options = [];
        // Get current month in GMT+7 as base
        const now = new Date();
        const utcMs = now.getTime() + (now.getTimezoneOffset() * 60000);
        const gmt7Ms = utcMs + (7 * 60 * 60 * 1000);
        const gmt7Now = new Date(gmt7Ms);

        for (let i = 0; i < 12; i++) {
            const d = new Date(gmt7Now.getFullYear(), gmt7Now.getMonth() - i, 1);
            const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            const label = d.toLocaleString('en-US', { month: 'long', year: 'numeric' });
            options.push({ value, label });
        }
        return options;
    };

    // Get team name by ID (with loading awareness)
    const getTeamName = (teamId) => {
        if (teamsLoading) return 'Loading...';
        if (teams.length === 0) return 'Unknown'; // Teams failed to load
        const team = teams.find(t => t._id === teamId);
        return team?.name || 'No Team';
    };

    // Loading state
    if (loading) {
        return (
            <div className="flex justify-center py-20">
                <Spinner size="xl" />
            </div>
        );
    }

    // Error state (403/404)
    if (error) {
        return (
            <div className="p-4">
                <Alert color="failure">
                    {error}
                </Alert>
                <Button color="light" className="mt-4" onClick={() => navigate('/team/members')}>
                    <HiArrowLeft className="mr-2 h-4 w-4" />
                    Back to Team Members
                </Button>
            </div>
        );
    }

    return (
        <div className="p-4">
            {/* Header - NO Edit/Reset buttons for Manager */}
            <div className="flex justify-between items-center mb-4">
                <div className="flex items-center gap-4">
                    <Button color="light" onClick={() => navigate('/team/members')}>
                        <HiArrowLeft className="h-4 w-4" />
                    </Button>
                    <h1 className="text-2xl font-bold text-gray-800">
                        {user?.name} ({user?.employeeCode})
                    </h1>
                </div>
                {/* Manager: Read-only - no action buttons */}
            </div>

            {/* Profile Card */}
            <Card className="mb-6">
                <h2 className="text-lg font-semibold text-gray-700 mb-4">Profile</h2>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    <div>
                        <p className="text-sm text-gray-500">Email</p>
                        <p className="font-medium">{user?.email || '-'}</p>
                    </div>
                    <div>
                        <p className="text-sm text-gray-500">Username</p>
                        <p className="font-medium">{user?.username || '-'}</p>
                    </div>
                    <div>
                        <p className="text-sm text-gray-500">Role</p>
                        <Badge color="info">{user?.role}</Badge>
                    </div>
                    <div>
                        <p className="text-sm text-gray-500">Team</p>
                        <p className="font-medium">{user?.teamId ? getTeamName(user.teamId) : 'No Team'}</p>
                    </div>
                    <div>
                        <p className="text-sm text-gray-500">Start Date</p>
                        <p className="font-medium">
                            {user?.startDate ? formatDate(user.startDate.split('T')[0]) : '-'}
                        </p>
                    </div>
                    <div>
                        <p className="text-sm text-gray-500">Status</p>
                        <Badge color={user?.isActive ? 'success' : 'failure'}>
                            {user?.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                    </div>
                </div>
            </Card>

            <Card className="mb-6">
                <h2 className="text-lg font-semibold text-gray-700 mb-4">Lịch đăng ký 7 ngày</h2>
                {scheduleError ? (
                    <Alert color="warning">{scheduleError}</Alert>
                ) : scheduleWindow.length === 0 ? (
                    <Alert color="info">Không có dữ liệu lịch đăng ký ca.</Alert>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {scheduleWindow.map((item) => (
                            <div key={item.workDate} className="border rounded p-3 flex items-center justify-between">
                                <div>
                                    <div className="font-medium">{formatDate(item.workDate)}</div>
                                    <div className="text-xs text-gray-500">
                                        {item.isWorkday ? 'Ngày làm việc' : (item.isHoliday ? 'Ngày lễ' : 'Cuối tuần')}
                                    </div>
                                </div>
                                <ScheduleBadge scheduleType={item.scheduleType} />
                            </div>
                        ))}
                    </div>
                )}
            </Card>

            {/* Monthly Attendance */}
            <Card>
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-lg font-semibold text-gray-700">Monthly Attendance</h2>
                    <div className="flex items-center gap-2">
                        <Label htmlFor="month" value="Month:" className="sr-only" />
                        <Select
                            id="month"
                            value={month}
                            onChange={(e) => setMonth(e.target.value)}
                            className="w-48"
                        >
                            {getMonthOptions().map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                </option>
                            ))}
                        </Select>
                    </div>
                </div>

                {attendanceLoading ? (
                    <div className="flex justify-center py-10">
                        <Spinner size="lg" />
                    </div>
                ) : attendanceError ? (
                    <Alert color="failure">{attendanceError}</Alert>
                ) : attendance.length === 0 ? (
                    <Alert color="info">No attendance records for this month.</Alert>
                ) : (
                    <div className="overflow-x-auto">
                        <Table striped>
                            <Table.Head>
                                <Table.HeadCell>Date</Table.HeadCell>
                                <Table.HeadCell>Check In</Table.HeadCell>
                                <Table.HeadCell>Check Out</Table.HeadCell>
                                <Table.HeadCell>Status</Table.HeadCell>
                                <Table.HeadCell>Ca</Table.HeadCell>
                                <Table.HeadCell>Work Time</Table.HeadCell>
                                <Table.HeadCell>OT</Table.HeadCell>
                            </Table.Head>
                            <Table.Body className="divide-y">
                                {attendance.map((item) => (
                                    <Table.Row key={item.date} className="bg-white">
                                        <Table.Cell className="font-medium">
                                            {formatDate(item.date)}
                                        </Table.Cell>
                                        <Table.Cell>{formatTime(item.checkInAt)}</Table.Cell>
                                        <Table.Cell>{formatTime(item.checkOutAt)}</Table.Cell>
                                        <Table.Cell>
                                            <Badge color={statusColors[item.status] || 'gray'}>
                                                {statusLabels[item.status] || 'Unknown'}
                                            </Badge>
                                        </Table.Cell>
                                        <Table.Cell>
                                            <ScheduleBadge scheduleType={item.scheduleType} />
                                        </Table.Cell>
                                        <Table.Cell>{formatMinutes(item.workMinutes)}</Table.Cell>
                                        <Table.Cell>{formatMinutes(item.otMinutes)}</Table.Cell>
                                    </Table.Row>
                                ))}
                            </Table.Body>
                        </Table>
                    </div>
                )}
            </Card>
        </div>
    );
}
