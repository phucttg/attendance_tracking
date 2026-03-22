import { useState, useEffect, useCallback, useRef } from 'react';
import {
    Table, Button, Modal, Spinner, Alert, Select, Label, TextInput, Toast
} from 'flowbite-react';
import { HiPlus, HiCheck, HiX, HiCalendar, HiTrash, HiLockClosed } from 'react-icons/hi';
import { getHolidays, createHoliday, createHolidayRange, deleteHoliday } from '../api/adminApi';
import { PageHeader } from '../components/ui';

/**
 * AdminHolidaysPage: Admin manages company holidays.
 * 
 * Features:
 * - List holidays by year (default: current year GMT+7)
 * - Year selector (last 3 years + next 2 years)
 * - Create holiday via modal (single date or date range)
 * - Form validation (date required, name required)
 * - Handle duplicate date error (409)
 * 
 * RBAC: ADMIN only (enforced by route + backend)
 */
export default function AdminHolidaysPage() {
    // Get current year in GMT+7
    const getCurrentYear = () => {
        const now = new Date();
        return new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }))
            .getFullYear()
            .toString();
    };

    // Data states
    const [holidays, setHolidays] = useState([]);
    const [selectedYear, setSelectedYear] = useState(() => getCurrentYear());
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    // Modal states
    const [createModal, setCreateModal] = useState(false);
    const [createMode, setCreateMode] = useState('single'); // 'single' | 'range'
    const [formData, setFormData] = useState({ date: '', name: '' });
    const [rangeFormData, setRangeFormData] = useState({ startDate: '', endDate: '', name: '' });
    const [formLoading, setFormLoading] = useState(false);
    const [formError, setFormError] = useState('');
    const [actionLoading, setActionLoading] = useState(null);
    const [skippedResults, setSkippedResults] = useState([]);

    // Toast state
    const [toast, setToast] = useState({ show: false, message: '', type: 'success' });
    const toastTimeoutRef = useRef(null);

    // Generate year options (last 3 years + next 2 years)
    const yearOptions = (() => {
        const currentYear = parseInt(getCurrentYear(), 10);
        const years = [];
        for (let y = currentYear - 3; y <= currentYear + 2; y++) {
            years.push(y.toString());
        }
        return years;
    })();

    // Fetch holidays when year changes
    const fetchHolidays = useCallback(async (signal) => {
        setLoading(true);
        setError('');
        try {
            const res = await getHolidays(selectedYear, signal ? { signal } : undefined);
            setHolidays(res.data.items || []);
        } catch (err) {
            if (err.name === 'CanceledError' || err.name === 'AbortError' || err?.code === 'ERR_CANCELED') return;
            setError(err.response?.data?.message || 'Failed to load holidays');
        } finally {
            setLoading(false);
        }
    }, [selectedYear]);

    useEffect(() => {
        const controller = new AbortController();
        fetchHolidays(controller.signal);
        return () => controller.abort();
    }, [fetchHolidays]);

    // Format date (YYYY-MM-DD → dd/mm/yyyy)
    const formatDate = (dateStr) => {
        if (!dateStr) return '-';
        const [year, month, day] = dateStr.split('-');
        return `${day}/${month}/${year}`;
    };

    // Open create modal with reset form
    const handleOpenCreate = () => {
        setFormData({ date: '', name: '' });
        setRangeFormData({ startDate: '', endDate: '', name: '' });
        setFormError('');
        setCreateMode('single');
        setCreateModal(true);
    };

    // Submit create single holiday
    const handleCreateSubmit = async () => {
        // Client-side validation
        if (!formData.date) {
            setFormError('Vui lòng chọn ngày');
            return;
        }
        if (!formData.name.trim()) {
            setFormError('Vui lòng nhập tên ngày nghỉ');
            return;
        }

        setFormLoading(true);
        setFormError('');
        try {
            await createHoliday({
                date: formData.date,
                name: formData.name.trim()
            });
            setSkippedResults([]);
            setCreateModal(false);
            showToast('Tạo ngày nghỉ thành công!', 'success');
            fetchHolidays(); // Refresh list
        } catch (err) {
            // Handle duplicate date (409)
            if (err.response?.status === 409) {
                setFormError('Ngày này đã có trong danh sách ngày nghỉ');
            } else {
                setFormError(err.response?.data?.message || 'Tạo ngày nghỉ thất bại');
            }
        } finally {
            setFormLoading(false);
        }
    };

    // Submit create holiday range
    const handleRangeSubmit = async () => {
        // Client-side validation
        if (!rangeFormData.startDate) {
            setFormError('Vui lòng chọn ngày bắt đầu');
            return;
        }
        if (!rangeFormData.endDate) {
            setFormError('Vui lòng chọn ngày kết thúc');
            return;
        }
        if (rangeFormData.endDate < rangeFormData.startDate) {
            setFormError('Ngày kết thúc phải >= ngày bắt đầu');
            return;
        }
        if (!rangeFormData.name.trim()) {
            setFormError('Vui lòng nhập tên ngày nghỉ');
            return;
        }

        setFormLoading(true);
        setFormError('');
        try {
            const res = await createHolidayRange({
                startDate: rangeFormData.startDate,
                endDate: rangeFormData.endDate,
                name: rangeFormData.name.trim()
            });
            setSkippedResults(res.data.skippedDates || []);
            setCreateModal(false);
            showToast(
                `Đã tạo ${res.data.created} ngày nghỉ` +
                (res.data.skipped > 0 ? `, bỏ qua ${res.data.skipped} ngày trùng` : ''),
                'success'
            );
            fetchHolidays(); // Refresh list
        } catch (err) {
            setFormError(err.response?.data?.message || 'Tạo khoảng ngày nghỉ thất bại. Không có thay đổi nào được lưu.');
        } finally {
            setFormLoading(false);
        }
    };

    const handleDeleteHoliday = async (holiday) => {
        if (actionLoading) return;

        const confirmText = `Xóa ngày nghỉ "${holiday.name}" (${formatDate(holiday.date)})? `
            + 'Đây là xóa thật và có thể làm thay đổi attendance, leave count và report lịch sử.';
        if (!window.confirm(confirmText)) return;

        setActionLoading(holiday._id);
        try {
            await deleteHoliday(holiday._id);
            setSkippedResults([]);
            showToast(`Đã xóa ngày nghỉ ${formatDate(holiday.date)}`, 'success');
            fetchHolidays();
        } catch (err) {
            showToast(err.response?.data?.message || 'Xóa ngày nghỉ thất bại', 'failure');
        } finally {
            setActionLoading(null);
        }
    };

    // Handle submit based on mode
    const handleSubmit = () => {
        if (createMode === 'single') {
            handleCreateSubmit();
        } else {
            handleRangeSubmit();
        }
    };

    // Toast helper with cleanup to avoid state update on unmount (P3 fix)
    const showToast = (message, type = 'success') => {
        if (toastTimeoutRef.current) {
            clearTimeout(toastTimeoutRef.current);
        }
        setToast({ show: true, message, type });
        toastTimeoutRef.current = setTimeout(() => {
            setToast({ show: false, message: '', type: 'success' });
        }, 3000);
    };

    // Cleanup toast timeout on unmount
    useEffect(() => {
        return () => {
            if (toastTimeoutRef.current) {
                clearTimeout(toastTimeoutRef.current);
            }
        };
    }, []);

    return (
        <div>
            <PageHeader title="Quản lý ngày nghỉ">
                <Select
                    value={selectedYear}
                    onChange={(e) => setSelectedYear(e.target.value)}
                    className="w-28"
                >
                    {yearOptions.map((year) => (
                        <option key={year} value={year}>{year}</option>
                    ))}
                </Select>
                <Button color="success" onClick={handleOpenCreate}>
                    <HiPlus className="mr-2 h-4 w-4" />
                    Thêm ngày nghỉ
                </Button>
            </PageHeader>

            {/* Error alert */}
            {error && (
                <Alert color="failure" className="mb-4">
                    {error}
                </Alert>
            )}

            {skippedResults.length > 0 && (
                <Alert color="warning" className="mb-4" onDismiss={() => setSkippedResults([])}>
                    {`Các ngày bị bỏ qua: ${skippedResults.map((item) => formatDate(item.date)).join(', ')}`}
                </Alert>
            )}

            {/* Loading */}
            {loading && (
                <div className="flex justify-center py-10">
                    <Spinner size="lg" />
                </div>
            )}

            {/* Empty state */}
            {!loading && !error && holidays.length === 0 && (
                <Alert color="info">
                    Không có ngày nghỉ nào trong năm {selectedYear}.
                </Alert>
            )}

            {/* Holidays table */}
            {!loading && holidays.length > 0 && (
                <div className="overflow-x-auto">
                    <Table striped>
                        <Table.Head>
                            <Table.HeadCell>Ngày</Table.HeadCell>
                            <Table.HeadCell>Tên</Table.HeadCell>
                            <Table.HeadCell>Thao tác</Table.HeadCell>
                        </Table.Head>
                        <Table.Body className="divide-y">
                            {holidays.map((holiday) => (
                                <Table.Row key={holiday._id} className="bg-white">
                                    <Table.Cell className="font-medium text-gray-900">
                                        {formatDate(holiday.date)}
                                    </Table.Cell>
                                    <Table.Cell>{holiday.name}</Table.Cell>
                                    <Table.Cell>
                                        {holiday.isLocked ? (
                                            <Button
                                                color="gray"
                                                size="xs"
                                                disabled
                                                title="Ngày nghỉ đã qua nên không thể xóa"
                                            >
                                                <HiLockClosed className="mr-2 h-4 w-4" />
                                                Đã khóa
                                            </Button>
                                        ) : (
                                            <Button
                                                color="failure"
                                                size="xs"
                                                onClick={() => handleDeleteHoliday(holiday)}
                                                disabled={Boolean(actionLoading)}
                                            >
                                                {actionLoading === holiday._id
                                                    ? <Spinner size="sm" className="mr-2" />
                                                    : <HiTrash className="mr-2 h-4 w-4" />}
                                                Xóa
                                            </Button>
                                        )}
                                    </Table.Cell>
                                </Table.Row>
                            ))}
                        </Table.Body>
                    </Table>
                </div>
            )}

            {/* Summary */}
            {!loading && holidays.length > 0 && (
                <p className="mt-4 text-sm text-gray-500">
                    Tổng: {holidays.length} ngày nghỉ
                </p>
            )}

            {/* Create Holiday Modal - prevent close while loading (P3 fix) */}
            <Modal show={createModal} onClose={() => !formLoading && setCreateModal(false)}>
                <Modal.Header>Thêm ngày nghỉ</Modal.Header>
                <Modal.Body>
                    {formError && (
                        <Alert color="failure" className="mb-4">{formError}</Alert>
                    )}

                    {/* Mode toggle */}
                    <div className="mb-4 flex items-center gap-4">
                        <Button
                            color={createMode === 'single' ? 'info' : 'gray'}
                            size="sm"
                            onClick={() => { setCreateMode('single'); setFormError(''); }}
                        >
                            <HiCalendar className="mr-2 h-4 w-4" />
                            Ngày đơn
                        </Button>
                        <Button
                            color={createMode === 'range' ? 'info' : 'gray'}
                            size="sm"
                            onClick={() => { setCreateMode('range'); setFormError(''); }}
                        >
                            <HiCalendar className="mr-2 h-4 w-4" />
                            Khoảng ngày
                        </Button>
                    </div>

                    {/* Single date form */}
                    {createMode === 'single' && (
                        <div className="space-y-4">
                            <div>
                                <Label htmlFor="holiday-date" value="Ngày *" />
                                <TextInput
                                    id="holiday-date"
                                    type="date"
                                    value={formData.date}
                                    onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                                    required
                                />
                            </div>
                            <div>
                                <Label htmlFor="holiday-name" value="Tên ngày nghỉ *" />
                                <TextInput
                                    id="holiday-name"
                                    type="text"
                                    value={formData.name}
                                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                                    placeholder="VD: Tết Dương lịch"
                                    required
                                />
                            </div>
                        </div>
                    )}

                    {/* Range form */}
                    {createMode === 'range' && (
                        <div className="space-y-4">
                            <div>
                                <Label htmlFor="range-start" value="Ngày bắt đầu *" />
                                <TextInput
                                    id="range-start"
                                    type="date"
                                    value={rangeFormData.startDate}
                                    onChange={(e) => setRangeFormData({ ...rangeFormData, startDate: e.target.value })}
                                    required
                                />
                            </div>
                            <div>
                                <Label htmlFor="range-end" value="Ngày kết thúc *" />
                                <TextInput
                                    id="range-end"
                                    type="date"
                                    value={rangeFormData.endDate}
                                    onChange={(e) => setRangeFormData({ ...rangeFormData, endDate: e.target.value })}
                                    required
                                />
                            </div>
                            <div>
                                <Label htmlFor="range-name" value="Tên ngày nghỉ *" />
                                <TextInput
                                    id="range-name"
                                    type="text"
                                    value={rangeFormData.name}
                                    onChange={(e) => setRangeFormData({ ...rangeFormData, name: e.target.value })}
                                    placeholder="VD: Nghỉ Tết Nguyên Đán"
                                    required
                                />
                            </div>
                            <Alert color="info" className="text-sm">
                                Tối đa 30 ngày. Các ngày đã tồn tại sẽ được bỏ qua.
                            </Alert>
                        </div>
                    )}
                </Modal.Body>
                <Modal.Footer>
                    <Button onClick={handleSubmit} disabled={formLoading}>
                        {formLoading ? <Spinner size="sm" className="mr-2" /> : <HiCheck className="mr-2" />}
                        Lưu
                    </Button>
                    <Button color="gray" onClick={() => setCreateModal(false)} disabled={formLoading}>
                        Hủy
                    </Button>
                </Modal.Footer>
            </Modal>

            {/* Toast */}
            {toast.show && (
                <div className="fixed bottom-4 right-4 z-50">
                    <Toast>
                        <div className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${toast.type === 'success'
                            ? 'bg-green-100 text-green-500'
                            : 'bg-red-100 text-red-500'
                            }`}>
                            {toast.type === 'success' ? <HiCheck className="h-5 w-5" /> : <HiX className="h-5 w-5" />}
                        </div>
                        <div className="ml-3 text-sm font-normal">{toast.message}</div>
                        <Toast.Toggle onClick={() => setToast({ ...toast, show: false })} />
                    </Toast>
                </div>
            )}
        </div>
    );
}
