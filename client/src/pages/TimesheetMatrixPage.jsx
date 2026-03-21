import { useState, useEffect, useCallback, useMemo } from 'react';
import { Table, Select, Spinner, Alert } from 'flowbite-react';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';
import { getTeams } from '../api/memberApi';

/**
 * TimesheetMatrixPage: Manager/Admin views team/company attendance matrix.
 *
 * Features:
 * - Matrix view: Rows (Employees) x Columns (Days of Month)
 * - Color-coded cells based on status (KEYS in RULES.md)
 * - Scope selector for Admin (Company vs specific Team)
 * - Month selector (Last 12 months)
 * 
 * Admin scope behavior:
 * - Default: 'company' (Toàn công ty)
 * - Can select specific team from dropdown
 * - When team selected, API called with teamId param
 * 
 * Manager behavior:
 * - Always uses /timesheet/team (backend uses token.teamId)
 */
export default function TimesheetMatrixPage() {
    const { user } = useAuth();
    const isAdmin = user?.role === 'ADMIN';

    // Today in GMT+7 for month calculation
    const today = useMemo(() => new Date().toLocaleDateString('sv-SE', {
        timeZone: 'Asia/Ho_Chi_Minh'
    }), []);

    // Filter states
    const [selectedMonth, setSelectedMonth] = useState(today.slice(0, 7));
    // NOTE: Initial scope may be wrong if user loads async (isAdmin = false initially)
    // We use useEffect below to sync scope when isAdmin changes
    const [scope, setScope] = useState('team');
    const [selectedTeamId, setSelectedTeamId] = useState('');

    // Teams dropdown for Admin
    const [teams, setTeams] = useState([]);
    const [teamsLoading, setTeamsLoading] = useState(false);
    const [teamsError, setTeamsError] = useState('');

    // Fetch teams on mount for Admin
    useEffect(() => {
        if (!isAdmin) return;

        let cancelled = false;
        setTeamsLoading(true);
        setTeamsError('');

        getTeams()
            .then(res => {
                if (cancelled) return;
                setTeams(Array.isArray(res.data?.items) ? res.data.items : []);
            })
            .catch(err => {
                if (cancelled) return;
                console.error('Failed to load teams:', err);
                setTeamsError('Không thể tải danh sách team');
            })
            .finally(() => {
                if (!cancelled) setTeamsLoading(false);
            });

        return () => { cancelled = true; };
    }, [isAdmin]);

    // Sync scope when isAdmin changes (handles async user load race condition)
    // - Admin: default to 'company' (avoids 400 error from /timesheet/team without teamId)
    // - Manager: force to 'team'
    useEffect(() => {
        if (isAdmin && scope === 'team' && !selectedTeamId) {
            // Admin just loaded, switch to company scope
            setScope('company');
        } else if (!isAdmin && scope === 'company') {
            // Not admin but somehow in company scope, force back to team
            setScope('team');
        }
    }, [isAdmin, scope, selectedTeamId]);

    // Data states
    const [data, setData] = useState({ days: [], rows: [] });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    // Generate last 12 months options (GMT+7)
    const monthOptions = useMemo(() => {
        const options = [];
        const [year, month] = today.split('-').map(Number);
        for (let i = 0; i < 12; i++) {
            const d = new Date(year, month - 1 - i, 1);
            const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            const label = d.toLocaleDateString('vi-VN', {
                year: 'numeric',
                month: 'long',
                timeZone: 'Asia/Ho_Chi_Minh',
            });
            options.push({ value, label });
        }
        return options;
    }, [today]);

    // Handle scope change from dropdown
    const handleScopeChange = (value) => {
        if (value === 'company') {
            setScope('company');
            setSelectedTeamId('');
        } else {
            // value is teamId
            setScope('team');
            setSelectedTeamId(value);
        }
    };

    // Fetch matrix data
    const fetchMatrix = useCallback(async (signal, showLoading = true) => {
        if (showLoading) setLoading(true);
        if (showLoading) setError('');
        try {
            const config = signal ? { signal } : undefined;

            let endpoint;
            if (isAdmin) {
                if (scope === 'company') {
                    // Admin viewing company-wide
                    endpoint = `/timesheet/company?month=${selectedMonth}`;
                } else {
                    // Admin viewing specific team - MUST include teamId
                    endpoint = `/timesheet/team?month=${selectedMonth}&teamId=${selectedTeamId}`;
                }
            } else {
                // Manager - backend uses token.teamId automatically
                endpoint = `/timesheet/team?month=${selectedMonth}`;
            }

            const res = await client.get(endpoint, config);
            setData({
                days: Array.isArray(res.data?.days) ? res.data.days : [],
                rows: Array.isArray(res.data?.rows) ? res.data.rows : [],
            });
        } catch (err) {
            if (err.name === 'CanceledError' || err.name === 'AbortError' || err?.code === 'ERR_CANCELED') return;
            setError(err.response?.data?.message || 'Failed to load timesheet');
        } finally {
            if (signal?.aborted) return;
            if (showLoading) setLoading(false);
        }
    }, [selectedMonth, scope, selectedTeamId, isAdmin]);

    // Fetch on filters change
    // For Admin with team scope, only fetch if teamId is selected
    useEffect(() => {
        // Skip if Admin selected team scope but hasn't chosen a team yet
        if (isAdmin && scope === 'team' && !selectedTeamId) {
            setLoading(false);
            setError(''); // Reset error to avoid stale error display
            setData({ days: [], rows: [] });
            return;
        }

        const controller = new AbortController();
        fetchMatrix(controller.signal, true);
        return () => controller.abort();
    }, [fetchMatrix, isAdmin, scope, selectedTeamId]);

    // Color mapping helper
    // Status keys MUST match RULES.md (source of truth)
    const getStatusColor = (status) => {
        const colorMap = {
            ON_TIME: 'bg-green-200 text-green-800',
            LATE: 'bg-red-200 text-red-800',
            EARLY_LEAVE: 'bg-yellow-200 text-yellow-800',
            LATE_AND_EARLY: 'bg-purple-200 text-purple-800', // NEW v2.3: combined late + early
            MISSING_CHECKOUT: 'bg-yellow-200 text-yellow-800',
            MISSING_CHECKIN: 'bg-orange-200 text-orange-800', // Edge case
            ABSENT: 'bg-gray-100 text-gray-500',
            WEEKEND_OR_HOLIDAY: 'bg-gray-300 text-gray-600', // Per RULES.md section 3.1
            WORKING: 'bg-blue-100 text-blue-800',
        };
        return colorMap[status] || 'bg-white text-gray-400';
    };

    // Status abbreviation helper
    // Status keys MUST match RULES.md (source of truth)
    const getStatusAbbr = (status) => {
        const abbrMap = {
            ON_TIME: '✓',
            LATE: 'M',      // Muộn
            EARLY_LEAVE: 'S', // Sớm
            LATE_AND_EARLY: 'M+S', // NEW v2.3: Muộn + Sớm
            MISSING_CHECKOUT: '?',
            MISSING_CHECKIN: '!', // Edge case
            ABSENT: 'V',    // Vắng
            WEEKEND_OR_HOLIDAY: '-', // Per RULES.md section 3.1
            WORKING: 'W',
        };
        return abbrMap[status] || '';
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <h1 className="text-2xl font-bold text-gray-800">Bảng chấm công</h1>

                <div className="flex flex-wrap gap-4 items-center">
                    {/* Scope Selector (Admin only) */}
                    {isAdmin && (
                        <Select
                            value={scope === 'company' ? 'company' : (selectedTeamId || 'company')}
                            onChange={e => handleScopeChange(e.target.value)}
                            disabled={loading || teamsLoading}
                        >
                            <option value="company">Toàn công ty</option>
                            {teamsError ? (
                                <option disabled>(Không thể tải teams)</option>
                            ) : teamsLoading ? (
                                <option disabled>Đang tải teams...</option>
                            ) : (
                                teams.map(team => (
                                    <option key={team._id} value={team._id}>
                                        {team.name}
                                    </option>
                                ))
                            )}
                        </Select>
                    )}

                    {/* Month Selector */}
                    <Select
                        value={selectedMonth}
                        onChange={e => setSelectedMonth(e.target.value)}
                        disabled={loading}
                    >
                        {monthOptions.map(opt => (
                            <option key={opt.value} value={opt.value}>
                                {opt.label}
                            </option>
                        ))}
                    </Select>
                </div>
            </div>

            {error && (
                <Alert color="failure" onDismiss={() => setError('')}>
                    {error}
                </Alert>
            )}

            {/* Legend */}
            {!loading && data.rows.length > 0 && (
                <div className="flex flex-wrap gap-4 text-xs text-gray-600 mt-4 p-4 bg-gray-50 rounded">
                    <div className="flex items-center gap-1"><span className="w-4 h-4 bg-green-200 border"></span> Đúng giờ (✓)</div>
                    <div className="flex items-center gap-1"><span className="w-4 h-4 bg-red-200 border"></span> Đi muộn (M)</div>
                    <div className="flex items-center gap-1"><span className="w-4 h-4 bg-yellow-200 border"></span> Về sớm/Thiếu checkout (S/?)</div>
                    <div className="flex items-center gap-1"><span className="w-4 h-4 bg-purple-200 border"></span> Muộn & Về sớm (M+S)</div>
                    <div className="flex items-center gap-1"><span className="w-4 h-4 bg-gray-100 border"></span> Vắng (V)</div>
                    <div className="flex items-center gap-1"><span className="w-4 h-4 bg-gray-300 border"></span> Cuối tuần/Lễ (-)</div>
                    <div className="flex items-center gap-1"><span className="w-4 h-4 bg-blue-100 border"></span> Đang làm (W)</div>
                </div>
            )}

            <div className="bg-white rounded-lg shadow">
                {loading ? (
                    <div className="flex justify-center py-12">
                        <Spinner size="lg" />
                    </div>
                ) : data.rows.length === 0 ? (
                    <div className="text-center py-12 text-gray-500">
                        Không có dữ liệu chấm công cho tháng này
                    </div>
                ) : (
                    <div className="max-h-[min(70vh,44rem)] overflow-auto overscroll-contain">
                        <Table hoverable>
                            <Table.Head>
                                <Table.HeadCell className="whitespace-nowrap min-w-[200px] sticky top-0 left-0 bg-gray-50 z-40 border-r">
                                    Nhân viên
                                </Table.HeadCell>
                                {data.days.map(day => (
                                    <Table.HeadCell key={day} className="sticky top-0 z-30 bg-gray-50 text-center w-8 px-1">
                                        {day}
                                    </Table.HeadCell>
                                ))}
                            </Table.Head>
                            <Table.Body className="divide-y">
                                {data.rows.map(row => (
                                    <Table.Row key={row.user._id} className="bg-white">
                                        <Table.Cell className="whitespace-nowrap font-medium text-gray-900 sticky left-0 bg-white z-20 border-r">
                                            <div>{row.user.name}</div>
                                            <div className="text-xs text-gray-500">{row.user.employeeCode}</div>
                                        </Table.Cell>
                                        {row.cells.map((cell, idx) => (
                                            <Table.Cell
                                                key={cell.date || idx}
                                                className={`text-center text-xs p-1 h-10 w-8 border ${getStatusColor(cell.status)}`}
                                                title={`${cell.date}: ${cell.status || 'N/A'}`}
                                            >
                                                {getStatusAbbr(cell.status)}
                                            </Table.Cell>
                                        ))}
                                    </Table.Row>
                                ))}
                            </Table.Body>
                        </Table>
                    </div>
                )}
            </div>

        </div>
    );
}
