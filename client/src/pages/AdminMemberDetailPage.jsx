import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, Table, Button, Spinner, Alert, Badge, Select, Label } from 'flowbite-react';
import { HiArrowLeft, HiPencil, HiKey } from 'react-icons/hi';

// API
import {
    getTeams,
    getUserAttendance,
    getUserById,
    getUserWorkSchedules,
    resetPassword,
    updateUser
} from '../api/memberApi';

// Components
import ToastNotification from '../components/ui/ToastNotification';
import EditMemberModal from '../components/modals/EditMemberModal';
import ResetPasswordModal from '../components/modals/ResetPasswordModal';

// Hooks & Utils
import { useToast } from '../hooks/useToast';
import { getCurrentMonth, formatDate, formatTime, formatMinutes, getMonthOptions } from '../utils/dateTimeFormat';
import { STATUS_COLORS, STATUS_LABELS } from '../utils/statusConfig';
import { ScheduleBadge } from '../components/ui';

/**
 * AdminMemberDetailPage: Admin views member profile + monthly attendance history.
 * 
 * Features:
 * - Profile card with user info
 * - Monthly attendance table with month picker
 * - Edit member modal
 * - Reset password modal
 * 
 * RBAC: ADMIN only (enforced by route + backend)
 */
export default function AdminMemberDetailPage() {
    const { id } = useParams();
    const navigate = useNavigate();
    const { toast, showToast, hideToast } = useToast();
    const isMounted = useRef(false);

    // Data states
    const [user, setUser] = useState(null);
    const [attendance, setAttendance] = useState([]);
    const [teams, setTeams] = useState([]);
    const [teamsLoading, setTeamsLoading] = useState(true);
    const [month, setMonth] = useState(getCurrentMonth());
    const [loading, setLoading] = useState(true);
    const [attendanceLoading, setAttendanceLoading] = useState(false);
    const [attendanceError, setAttendanceError] = useState(''); // Distinguish API error vs no data
    const [scheduleWindow, setScheduleWindow] = useState([]);
    const [scheduleError, setScheduleError] = useState('');
    const [error, setError] = useState('');

    // Race condition protection: track latest request
    const attendanceRequestIdRef = useRef(0);

    // Modal states (simplified with new components)
    const [editUser, setEditUser] = useState(null);
    const [resetModal, setResetModal] = useState(false);

    // Cleanup on unmount
    useEffect(() => {
        isMounted.current = true;
        return () => {
            isMounted.current = false;
        };
    }, []);

    // Fetch teams for edit modal
    useEffect(() => {
        const fetchTeamsList = async () => {
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
                    if (err.response?.status === 404) {
                        setError('User not found');
                    } else if (err.response?.status === 403) {
                        setError('Access denied');
                    } else {
                        setError(err.response?.data?.message || 'Failed to load user');
                    }
                }
            } finally {
                if (isMounted.current) setLoading(false);
            }
        };
        if (id) fetchUser();
    }, [id]);

    // Fetch attendance when month changes (with race condition protection)
    const fetchAttendance = useCallback(async () => {
        if (!id || !month) return;

        // Race condition guard: increment requestId
        const currentRequestId = ++attendanceRequestIdRef.current;

        setAttendanceLoading(true);
        setAttendanceError('');
        try {
            const res = await getUserAttendance(id, month);
            // Only update if this is still the latest request
            if (isMounted.current && currentRequestId === attendanceRequestIdRef.current) {
                setAttendance(res.data.items || []);
            }
        } catch (err) {
            console.error('Failed to fetch attendance:', err);
            // Only update if this is still the latest request
            if (isMounted.current && currentRequestId === attendanceRequestIdRef.current) {
                setAttendance([]);
                setAttendanceError(err.response?.data?.message || 'Failed to load attendance');
            }
        } finally {
            if (isMounted.current && currentRequestId === attendanceRequestIdRef.current) {
                setAttendanceLoading(false);
            }
        }
    }, [id, month]);

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

    // Edit member handler (simplified - uses EditMemberModal component)
    // Modal calls: onSubmit(data, userId) - errors propagate to modal's catch block
    const handleEditSubmit = async (data, userId) => {
        const res = await updateUser(userId, data);
        setUser(res.data.user); // Update local user state immediately
        showToast('Member updated successfully', 'success');
    };

    // Reset password handler (simplified - uses ResetPasswordModal component)
    // Modal calls: onSubmit(password) - errors propagate to modal's catch block
    const handleResetSubmit = async (newPassword) => {
        if (!user?._id) return; // Defensive guard
        await resetPassword(user._id, newPassword);
        showToast('Password updated', 'success');
    };

    // Get team name by ID (handles loading state to prevent flickering)
    const getTeamName = (teamId) => {
        if (!teamId) return 'No Team';
        if (teamsLoading) return '...';  // Teams still loading
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

    // Error state
    if (error) {
        return (
            <div className="p-4">
                <Alert color="failure">
                    {error}
                </Alert>
                <Button color="light" className="mt-4" onClick={() => navigate('/admin/members')}>
                    <HiArrowLeft className="mr-2 h-4 w-4" />
                    Back to Members
                </Button>
            </div>
        );
    }

    return (
        <div className="p-4">
            {/* Header */}
            <div className="flex justify-between items-center mb-4">
                <div className="flex items-center gap-4">
                    <Button color="light" onClick={() => navigate('/admin/members')}>
                        <HiArrowLeft className="h-4 w-4" />
                    </Button>
                    <h1 className="text-2xl font-bold text-gray-800">
                        {user?.name} ({user?.employeeCode})
                    </h1>
                </div>
                <div className="flex gap-2">
                    <Button color="light" onClick={() => setEditUser(user)}>
                        <HiPencil className="mr-2 h-4 w-4" />
                        Edit
                    </Button>
                    <Button color="light" onClick={() => setResetModal(true)}>
                        <HiKey className="mr-2 h-4 w-4" />
                        Reset Password
                    </Button>
                </div>
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
                        <p className="font-medium">{getTeamName(user?.teamId)}</p>
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
                                            <Badge color={STATUS_COLORS[item.status] || 'gray'}>
                                                {STATUS_LABELS[item.status] || 'Unknown'}
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

            {/* Edit Modal */}
            <EditMemberModal
                show={!!editUser}
                user={editUser}
                teams={teams}
                onClose={() => setEditUser(null)}
                onSubmit={handleEditSubmit}
            />

            {/* Reset Password Modal */}
            <ResetPasswordModal
                show={resetModal}
                userName={user?.name}
                onClose={() => setResetModal(false)}
                onSubmit={handleResetSubmit}
            />

            {/* Toast */}
            <ToastNotification {...toast} onClose={hideToast} />
        </div>
    );
}
