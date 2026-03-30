import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Select, Spinner, Table } from 'flowbite-react';
import { PageHeader, ScheduleBadge } from '../components/ui';
import { getMyWorkSchedules, putMyWorkSchedules } from '../api/memberApi';

const SCHEDULE_OPTIONS = [
    { value: '', label: 'Chưa chốt' },
    { value: 'SHIFT_1', label: 'Ca 1' },
    { value: 'SHIFT_2', label: 'Ca 2' },
    { value: 'FLEXIBLE', label: 'Linh hoạt' },
];

const LOCKED_REASON_LABELS = {
    PAST_DATE: 'Ngày quá khứ',
    ALREADY_CHECKED_IN: 'Đã check-in',
    NON_WORKDAY: 'Cuối tuần / ngày lễ',
    OUTSIDE_WINDOW: 'Ngoài cửa sổ 7 ngày',
    OT_LOCKED: 'Đã có OT đang chờ/đã duyệt',
    SCHEDULE_LOCKED: 'Đã chốt ca, không thể chỉnh sửa',
};

const formatDate = (dateKey) => {
    if (!dateKey) return '-';
    const date = new Date(`${dateKey}T00:00:00+07:00`);
    return date.toLocaleDateString('vi-VN', {
        weekday: 'short',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        timeZone: 'Asia/Ho_Chi_Minh',
    });
};

export default function MySchedulePage() {
    const [windowData, setWindowData] = useState(null);
    const [draft, setDraft] = useState({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [errorsByDate, setErrorsByDate] = useState({});

    const loadData = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const res = await getMyWorkSchedules();
            const payload = res.data || {};
            const items = Array.isArray(payload.items) ? payload.items : [];
            const nextDraft = {};
            for (const item of items) {
                nextDraft[item.workDate] = item.scheduleType || '';
            }
            setDraft(nextDraft);
            setWindowData(payload);
        } catch (err) {
            setError(err.response?.data?.message || 'Không thể tải lịch đăng ký ca');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const items = useMemo(() => Array.isArray(windowData?.items) ? windowData.items : [], [windowData]);

    const handleChange = (workDate, value) => {
        setDraft((prev) => ({ ...prev, [workDate]: value }));
        setErrorsByDate((prev) => {
            if (!prev[workDate]) return prev;
            const next = { ...prev };
            delete next[workDate];
            return next;
        });
    };

    const handleSave = async () => {
        if (!windowData?.items) return;

        setSaving(true);
        setError('');
        setSuccess('');
        setErrorsByDate({});

        const payloadItems = items.map((item) => ({
            workDate: item.workDate,
            scheduleType: draft[item.workDate] || null,
        }));

        try {
            const res = await putMyWorkSchedules(payloadItems);
            const payload = res.data || {};
            const refreshedItems = Array.isArray(payload.items) ? payload.items : [];
            const nextDraft = {};
            for (const item of refreshedItems) {
                nextDraft[item.workDate] = item.scheduleType || '';
            }
            setDraft(nextDraft);
            setWindowData(payload);
            setSuccess('Đã chốt lịch đăng ký ca');
        } catch (err) {
            const response = err.response?.data || {};
            if (response.code === 'INVALID_SCHEDULE_WINDOW' && response.errorsByDate) {
                setErrorsByDate(response.errorsByDate);
            }
            setError(response.message || 'Không thể lưu lịch đăng ký ca');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="space-y-4">
            <PageHeader
                title="My Schedule"
                subtitle="Chọn ca cho 7 ngày tới (hôm nay + 6 ngày). Khi đã chốt ca sẽ không thể sửa lại."
            >
                <Button color="blue" onClick={handleSave} disabled={loading || saving}>
                    {saving ? (
                        <>
                            <Spinner size="sm" className="mr-2" />
                            Đang lưu...
                        </>
                    ) : 'Chốt lịch'}
                </Button>
            </PageHeader>

            {success && (
                <Alert color="success" onDismiss={() => setSuccess('')}>
                    {success}
                </Alert>
            )}
            {error && (
                <Alert color="failure" onDismiss={() => setError('')}>
                    {error}
                </Alert>
            )}

            {loading ? (
                <div className="flex justify-center py-12">
                    <Spinner size="lg" />
                </div>
            ) : (
                <Card>
                    <div className="overflow-x-auto">
                        <Table striped>
                            <Table.Head>
                                <Table.HeadCell>Ngày</Table.HeadCell>
                                <Table.HeadCell>Loại ngày</Table.HeadCell>
                                <Table.HeadCell>Ca hiện tại</Table.HeadCell>
                                <Table.HeadCell>Đăng ký</Table.HeadCell>
                                <Table.HeadCell>Trạng thái</Table.HeadCell>
                            </Table.Head>
                            <Table.Body className="divide-y">
                                {items.map((item) => {
                                    const lockedError = errorsByDate[item.workDate];
                                    const lockedReasonLabel = LOCKED_REASON_LABELS[item.lockedReason] || item.lockedReason || '-';
                                    const isDisabled = Boolean(item.isReadOnly || item.isLocked || saving);

                                    return (
                                        <Table.Row key={item.workDate} className={lockedError ? 'bg-red-50' : 'bg-white'}>
                                            <Table.Cell className="font-medium">{formatDate(item.workDate)}</Table.Cell>
                                            <Table.Cell>
                                                {item.isWorkday ? 'Ngày làm việc' : (item.isHoliday ? 'Ngày lễ' : 'Cuối tuần')}
                                            </Table.Cell>
                                            <Table.Cell>
                                                <ScheduleBadge scheduleType={item.scheduleType} />
                                            </Table.Cell>
                                            <Table.Cell>
                                                <Select
                                                    value={draft[item.workDate] ?? ''}
                                                    onChange={(e) => handleChange(item.workDate, e.target.value)}
                                                    disabled={isDisabled}
                                                    color={lockedError ? 'failure' : 'gray'}
                                                >
                                                    {SCHEDULE_OPTIONS.map((opt) => (
                                                        <option key={opt.value || 'empty'} value={opt.value}>
                                                            {opt.label}
                                                        </option>
                                                    ))}
                                                </Select>
                                            </Table.Cell>
                                            <Table.Cell>
                                                {lockedError
                                                    ? `Lỗi: ${LOCKED_REASON_LABELS[lockedError] || lockedError}`
                                                    : (item.isReadOnly ? lockedReasonLabel : 'Có thể sửa')}
                                                {item.isSuppressedByCalendar && (
                                                    <div className="text-xs text-amber-600 mt-1">Đã suppress do lịch ngày nghỉ</div>
                                                )}
                                            </Table.Cell>
                                        </Table.Row>
                                    );
                                })}
                            </Table.Body>
                        </Table>
                    </div>
                </Card>
            )}
        </div>
    );
}
