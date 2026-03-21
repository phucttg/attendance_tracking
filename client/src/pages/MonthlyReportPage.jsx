import { useState, useEffect, useCallback, useMemo } from 'react';
import { Table, Select, Button, Spinner, Alert, Modal } from 'flowbite-react';
import { HiDownload } from 'react-icons/hi';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';
import { getTeams } from '../api/memberApi';
import { downloadBlob } from '../utils/downloadBlob';

/**
 * MonthlyReportPage: Manager/Admin views monthly summary + exports Excel.
 *
 * Features:
 * - Summary table: Employee stats (work hours, late days, OT)
 * - Scope selector for Admin (Team vs Company)
 * - Month selector (Last 12 months)
 * - Excel export via new tab download
 */
export default function MonthlyReportPage() {
    const { user } = useAuth();
    const isAdmin = user?.role === 'ADMIN';

    // Today in GMT+7 for month calculation
    const today = useMemo(() => new Date().toLocaleDateString('sv-SE', {
        timeZone: 'Asia/Ho_Chi_Minh'
    }), []);

    // Filter states
    const [selectedMonth, setSelectedMonth] = useState(today.slice(0, 7));
    // Default: Admin sees company, Manager sees team (avoids 400 when Admin has no teamId)
    const [scope, setScope] = useState(isAdmin ? 'company' : 'team');
    const [selectedTeamId, setSelectedTeamId] = useState('');

    // Teams dropdown for Admin
    const [teams, setTeams] = useState([]);
    const [teamsLoading, setTeamsLoading] = useState(false);
    const [teamsError, setTeamsError] = useState('');

    // Data states
    const [summary, setSummary] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [exporting, setExporting] = useState(false); // Export loading state
    const [lateDetailsModal, setLateDetailsModal] = useState({
        open: false,
        employeeName: '',
        employeeCode: '',
        details: [],
    });

    // Derived scope: non-admin always uses 'team' (prevents race condition on role change)
    const effectiveScope = isAdmin ? scope : 'team';
    const requiresTeamSelection = isAdmin && effectiveScope === 'team' && !selectedTeamId;

    // Defense-in-depth: non-admin always uses team scope
    useEffect(() => {
        if (!isAdmin && scope !== 'team') setScope('team');
    }, [isAdmin, scope]);

    // Keep Admin default scope as company when role is loaded asynchronously
    useEffect(() => {
        if (isAdmin && scope !== 'company' && !selectedTeamId) {
            setScope('company');
        }
        // Intentionally only react when role flips to admin
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isAdmin]);

    // Fetch teams on mount for Admin
    useEffect(() => {
        if (!isAdmin) {
            setTeams([]);
            setTeamsError('');
            setSelectedTeamId('');
            return;
        }

        let cancelled = false;
        setTeamsLoading(true);
        setTeamsError('');

        getTeams()
            .then((res) => {
                if (cancelled) return;
                setTeams(Array.isArray(res.data?.items) ? res.data.items : []);
            })
            .catch(() => {
                if (cancelled) return;
                setTeamsError('Không thể tải danh sách team');
            })
            .finally(() => {
                if (!cancelled) setTeamsLoading(false);
            });

        return () => { cancelled = true; };
    }, [isAdmin]);

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

    const totals = useMemo(() => summary.reduce((acc, row) => {
        acc.totalWorkdays += row?.totalWorkdays ?? 0;
        acc.presentDays += row?.presentDays ?? 0;
        acc.absentDays += row?.absentDays ?? 0;
        acc.leaveDays += row?.leaveDays ?? 0;
        acc.annualLeave += row?.leaveByType?.ANNUAL ?? 0;
        acc.sickLeave += row?.leaveByType?.SICK ?? 0;
        acc.unpaidLeave += row?.leaveByType?.UNPAID ?? 0;
        acc.totalWorkMinutes += row?.totalWorkMinutes ?? 0;
        acc.totalLateCount += row?.totalLateCount ?? 0;
        acc.totalLateMinutes += row?.totalLateMinutes ?? 0;
        acc.earlyLeaveCount += row?.earlyLeaveCount ?? 0;
        acc.approvedOtMinutes += row?.approvedOtMinutes ?? 0;
        acc.unapprovedOtMinutes += row?.unapprovedOtMinutes ?? 0;
        return acc;
    }, {
        totalWorkdays: 0,
        presentDays: 0,
        absentDays: 0,
        leaveDays: 0,
        annualLeave: 0,
        sickLeave: 0,
        unpaidLeave: 0,
        totalWorkMinutes: 0,
        totalLateCount: 0,
        totalLateMinutes: 0,
        earlyLeaveCount: 0,
        approvedOtMinutes: 0,
        unapprovedOtMinutes: 0
    }), [summary]);

    const buildReportEndpoint = useCallback((basePath) => {
        let endpoint = `${basePath}?month=${selectedMonth}&scope=${effectiveScope}`;
        if (isAdmin && effectiveScope === 'team' && selectedTeamId) {
            endpoint += `&teamId=${selectedTeamId}`;
        }
        return endpoint;
    }, [selectedMonth, effectiveScope, selectedTeamId, isAdmin]);

    // Fetch report data
    const fetchReport = useCallback(async (signal, showLoading = true) => {
        if (showLoading) setLoading(true);
        if (showLoading) setError('');

        if (requiresTeamSelection) {
            if (showLoading && !signal?.aborted) {
                setSummary([]);
                setLoading(false);
                setError('Vui lòng chọn team để xem báo cáo theo team.');
            }
            return;
        }

        try {
            const config = signal ? { signal } : undefined;
            const endpoint = buildReportEndpoint('/reports/monthly');
            const res = await client.get(endpoint, config);
            setSummary(Array.isArray(res.data?.summary) ? res.data.summary : []);
        } catch (err) {
            if (err.name === 'CanceledError' || err.name === 'AbortError' || err?.code === 'ERR_CANCELED') return;
            setError(err.response?.data?.message || 'Failed to load report');
        } finally {
            // Guard setState - don't update if aborted (component may be unmounted)
            if (!signal?.aborted && showLoading) {
                setLoading(false);
            }
        }
    }, [buildReportEndpoint, requiresTeamSelection]);

    // Fetch on filters change
    useEffect(() => {
        const controller = new AbortController();
        fetchReport(controller.signal, true);
        return () => controller.abort();
    }, [fetchReport]);

    // Handle Excel export (secure Blob download - OWASP A09 compliant)
    const handleExport = async () => {
        if (requiresTeamSelection) {
            setError('Vui lòng chọn team trước khi xuất báo cáo.');
            return;
        }

        setExporting(true);
        setError('');
        try {
            const response = await client.get(
                buildReportEndpoint('/reports/monthly/export'),
                { responseType: 'blob' }
            );

            // Get filename from Content-Disposition header if available
            const contentDisposition = response.headers['content-disposition'];
            let filename = `report-${selectedMonth}-${effectiveScope}.xlsx`;
            if (contentDisposition) {
                const match = contentDisposition.match(/filename[^;=\n]*=(['"]?)([^'"\n]*?)\1(?:;|$)/);
                if (match && match[2]) {
                    filename = match[2];
                }
            }

            downloadBlob(response.data, filename);
        } catch (err) {
            // Handle blob error response (parse JSON message from blob)
            let errorMessage = 'Xuất báo cáo thất bại';
            if (err.response?.status === 401) {
                errorMessage = 'Phiên đăng nhập hết hạn. Vui lòng đăng nhập lại.';
            } else if (err.response?.data instanceof Blob) {
                try {
                    const text = await err.response.data.text();
                    const json = JSON.parse(text);
                    errorMessage = json.message || errorMessage;
                } catch { /* ignore parse error */ }
            } else {
                errorMessage = err.response?.data?.message || errorMessage;
            }
            setError(errorMessage);
        } finally {
            setExporting(false);
        }
    };

    // Format minutes to hours (e.g., 480 → "8.0h")
    const formatHours = (minutes) => {
        if (!minutes || minutes <= 0) return '0h';
        return `${(minutes / 60).toFixed(1)}h`;
    };

    const formatDateShort = (dateKey) => {
        if (!dateKey || typeof dateKey !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
            return dateKey || '';
        }
        const [, month, day] = dateKey.split('-');
        return `${day}/${month}`;
    };

    const closeLateDetailsModal = () => {
        setLateDetailsModal({
            open: false,
            employeeName: '',
            employeeCode: '',
            details: [],
        });
    };

    const openLateDetailsModal = (row) => {
        const lateCount = row?.totalLateCount || 0;
        const details = Array.isArray(row?.lateDetails) ? row.lateDetails : [];
        if (lateCount <= 0 || details.length === 0) return;

        setLateDetailsModal({
            open: true,
            employeeName: row?.user?.name || 'N/A',
            employeeCode: row?.user?.employeeCode || 'N/A',
            details,
        });
    };

    const renderLateCell = (row) => {
        const lateCount = row?.totalLateCount || 0;
        const details = Array.isArray(row?.lateDetails) ? row.lateDetails : [];
        const className = lateCount > 0 ? 'text-red-600 font-medium' : '';

        if (lateCount <= 0 || details.length === 0) {
            return <span className={className}>{lateCount}</span>;
        }

        return (
            <button
                type="button"
                className={`underline decoration-dotted underline-offset-2 ${className}`}
                onClick={() => openLateDetailsModal(row)}
                aria-label={`Xem chi tiết đi muộn của ${row?.user?.name || 'nhân viên'}`}
            >
                {lateCount}
            </button>
        );
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <h1 className="text-2xl font-bold text-gray-800">Báo cáo tháng</h1>

                <div className="flex flex-wrap gap-4 items-center">
                    {/* Scope Selector (Admin only) */}
                    {isAdmin && (
                        <Select
                            value={scope}
                            onChange={e => setScope(e.target.value)}
                            disabled={loading}
                        >
                            <option value="team">Theo team</option>
                            <option value="company">Toàn công ty</option>
                        </Select>
                    )}

                    {isAdmin && effectiveScope === 'team' && (
                        <Select
                            value={selectedTeamId}
                            onChange={(e) => setSelectedTeamId(e.target.value)}
                            disabled={loading || teamsLoading}
                        >
                            <option value="">
                                {teamsLoading ? 'Đang tải team...' : 'Chọn team'}
                            </option>
                            {teams.map((team) => (
                                <option key={team._id} value={team._id}>
                                    {team.name}
                                </option>
                            ))}
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

                    {/* Export Button */}
                    <Button
                        color="success"
                        onClick={handleExport}
                        disabled={loading || exporting || summary.length === 0 || requiresTeamSelection}
                    >
                        {exporting ? (
                            <>
                                <Spinner size="sm" className="mr-2" />
                                Đang tải...
                            </>
                        ) : (
                            <>
                                <HiDownload className="mr-2 h-5 w-5" />
                                Xuất Excel
                            </>
                        )}
                    </Button>
                </div>
            </div>

            {error && (
                <Alert color="failure" onDismiss={() => setError('')}>
                    {error}
                </Alert>
            )}
            {teamsError && isAdmin && (
                <Alert color="warning" onDismiss={() => setTeamsError('')}>
                    {teamsError}
                </Alert>
            )}

            <div className="bg-white rounded-lg shadow">
                {loading ? (
                    <div className="flex justify-center py-12">
                        <Spinner size="lg" />
                    </div>
                ) : summary.length === 0 ? (
                    <div className="text-center py-12 text-gray-500">
                        Không có dữ liệu báo cáo cho tháng này
                    </div>
                ) : (
                    <div className="max-h-[min(70vh,44rem)] overflow-auto overscroll-contain">
                        <Table striped>
                            <Table.Head>
                                <Table.HeadCell className="sticky top-0 z-30 bg-gray-50">Mã NV</Table.HeadCell>
                                <Table.HeadCell className="sticky top-0 z-30 bg-gray-50">Tên NV</Table.HeadCell>
                                <Table.HeadCell className="sticky top-0 z-30 bg-gray-50">Phòng ban</Table.HeadCell>
                                <Table.HeadCell className="sticky top-0 z-30 bg-gray-50 text-right">Ngày công tháng</Table.HeadCell>
                                <Table.HeadCell className="sticky top-0 z-30 bg-gray-50 text-right">Có mặt</Table.HeadCell>
                                <Table.HeadCell className="sticky top-0 z-30 bg-gray-50 text-right">Vắng mặt</Table.HeadCell>
                                <Table.HeadCell className="sticky top-0 z-30 bg-gray-50 text-right">Nghỉ phép</Table.HeadCell>
                                <Table.HeadCell className="sticky top-0 z-30 bg-gray-50 text-right">Phép năm</Table.HeadCell>
                                <Table.HeadCell className="sticky top-0 z-30 bg-gray-50 text-right">Nghỉ ốm</Table.HeadCell>
                                <Table.HeadCell className="sticky top-0 z-30 bg-gray-50 text-right">Không lương</Table.HeadCell>
                                <Table.HeadCell className="sticky top-0 z-30 bg-gray-50 text-right">Giờ làm (h)</Table.HeadCell>
                                <Table.HeadCell className="sticky top-0 z-30 bg-gray-50 text-right">Đi muộn (lần)</Table.HeadCell>
                                <Table.HeadCell className="sticky top-0 z-30 bg-gray-50 text-right">Đi muộn (phút)</Table.HeadCell>
                                <Table.HeadCell className="sticky top-0 z-30 bg-gray-50 text-right">Về sớm (lần)</Table.HeadCell>
                                <Table.HeadCell className="sticky top-0 z-30 bg-gray-50 text-right">OT duyệt (h)</Table.HeadCell>
                                <Table.HeadCell className="sticky top-0 z-30 bg-gray-50 text-right">OT chưa duyệt (h)</Table.HeadCell>
                            </Table.Head>
                            <Table.Body className="divide-y">
                                {summary.map(row => (
                                    <Table.Row key={row.user._id} className="bg-white">
                                        <Table.Cell className="font-medium text-gray-900">
                                            {row.user.employeeCode || 'N/A'}
                                        </Table.Cell>
                                        <Table.Cell>
                                            {row.user.name || 'N/A'}
                                        </Table.Cell>
                                        <Table.Cell className="text-right">
                                            {row.user.teamName || '-'}
                                        </Table.Cell>
                                        <Table.Cell className="text-right">
                                            {row.totalWorkdays || 0}
                                        </Table.Cell>
                                        <Table.Cell className="text-right">
                                            {row.presentDays || 0}
                                        </Table.Cell>
                                        <Table.Cell className="text-right">
                                            {row.absentDays || 0}
                                        </Table.Cell>
                                        <Table.Cell className="text-right">
                                            {row.leaveDays || 0}
                                        </Table.Cell>
                                        <Table.Cell className="text-right">
                                            {row.leaveByType?.ANNUAL || 0}
                                        </Table.Cell>
                                        <Table.Cell className="text-right">
                                            {row.leaveByType?.SICK || 0}
                                        </Table.Cell>
                                        <Table.Cell className="text-right">
                                            {row.leaveByType?.UNPAID || 0}
                                        </Table.Cell>
                                        <Table.Cell className="text-right">
                                            {formatHours(row.totalWorkMinutes)}
                                        </Table.Cell>
                                        <Table.Cell className="text-right">
                                            {renderLateCell(row)}
                                        </Table.Cell>
                                        <Table.Cell className="text-right">
                                            {row.totalLateMinutes || 0}
                                        </Table.Cell>
                                        <Table.Cell className="text-right">
                                            {row.earlyLeaveCount || 0}
                                        </Table.Cell>
                                        <Table.Cell className="text-right">
                                            <span className={row.approvedOtMinutes > 0 ? 'text-blue-600 font-medium' : ''}>
                                                {formatHours(row.approvedOtMinutes)}
                                            </span>
                                        </Table.Cell>
                                        <Table.Cell className="text-right">
                                            <span className={row.unapprovedOtMinutes > 0 ? 'text-orange-600 font-medium' : ''}>
                                                {formatHours(row.unapprovedOtMinutes)}
                                            </span>
                                        </Table.Cell>
                                    </Table.Row>
                                ))}
                                <Table.Row className="bg-gray-100 font-semibold">
                                    <Table.Cell>TỔNG</Table.Cell>
                                    <Table.Cell>-</Table.Cell>
                                    <Table.Cell className="text-right">-</Table.Cell>
                                    <Table.Cell className="text-right">{totals.totalWorkdays}</Table.Cell>
                                    <Table.Cell className="text-right">{totals.presentDays}</Table.Cell>
                                    <Table.Cell className="text-right">{totals.absentDays}</Table.Cell>
                                    <Table.Cell className="text-right">{totals.leaveDays}</Table.Cell>
                                    <Table.Cell className="text-right">{totals.annualLeave}</Table.Cell>
                                    <Table.Cell className="text-right">{totals.sickLeave}</Table.Cell>
                                    <Table.Cell className="text-right">{totals.unpaidLeave}</Table.Cell>
                                    <Table.Cell className="text-right">{formatHours(totals.totalWorkMinutes)}</Table.Cell>
                                    <Table.Cell className="text-right">{totals.totalLateCount}</Table.Cell>
                                    <Table.Cell className="text-right">{totals.totalLateMinutes}</Table.Cell>
                                    <Table.Cell className="text-right">{totals.earlyLeaveCount}</Table.Cell>
                                    <Table.Cell className="text-right">{formatHours(totals.approvedOtMinutes)}</Table.Cell>
                                    <Table.Cell className="text-right">{formatHours(totals.unapprovedOtMinutes)}</Table.Cell>
                                </Table.Row>
                            </Table.Body>
                        </Table>
                    </div>
                )}
            </div>

            {/* Summary footer */}
            {!loading && summary.length > 0 && (
                <div className="text-sm text-gray-500">
                    Tổng: {summary.length} nhân viên
                </div>
            )}

            <Modal show={lateDetailsModal.open} onClose={closeLateDetailsModal} size="md">
                <Modal.Header>Chi tiết đi muộn</Modal.Header>
                <Modal.Body>
                    <div className="space-y-3">
                        <div className="text-sm text-gray-600">
                            <span className="font-medium">{lateDetailsModal.employeeName}</span>
                            {lateDetailsModal.employeeCode && (
                                <span className="ml-2">({lateDetailsModal.employeeCode})</span>
                            )}
                        </div>

                        {lateDetailsModal.details.length === 0 ? (
                            <div className="text-sm text-gray-500">Không có dữ liệu chi tiết.</div>
                        ) : (
                            <div className="space-y-2">
                                {lateDetailsModal.details.map((item, idx) => (
                                    <div
                                        key={`${item.date}-${item.checkInTime}-${idx}`}
                                        className="flex items-center justify-between rounded border border-gray-100 px-3 py-2 text-sm"
                                    >
                                        <span>{formatDateShort(item.date)} {item.checkInTime}</span>
                                        <span className="font-medium text-red-600">{item.lateMinutes}p</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </Modal.Body>
                <Modal.Footer>
                    <Button color="gray" onClick={closeLateDetailsModal}>
                        Đóng
                    </Button>
                </Modal.Footer>
            </Modal>
        </div>
    );
}
