import { useEffect, useState } from 'react';
import {
    Label,
    TextInput,
    Textarea,
    Button,
    Spinner,
    Alert,
    Modal,
    Select,
} from 'flowbite-react';
import { HiPlus } from 'react-icons/hi';
import { createRequest } from '../../api/requestApi';
import { getMyWorkSchedules } from '../../api/memberApi';
import {
    addDaysToDate,
    buildIsoTimestamp,
    getNextDayDisplay,
} from '../../utils/dateDisplay';

const OT_CROSS_MIDNIGHT_CUTOFF = '08:00';
const OT_MODE_CONTINUOUS = 'CONTINUOUS';
const OT_MODE_SEPARATED = 'SEPARATED';
const FIXED_SHIFT_OT_POLICIES = {
    SHIFT_1: {
        label: 'Ca 1',
        threshold: '17:30',
        earliestEnd: '18:00',
    },
    SHIFT_2: {
        label: 'Ca 2',
        threshold: '18:30',
        earliestEnd: '19:00',
    },
};

const isCrossMidnightOt = (timeValue) =>
    Boolean(timeValue) && timeValue < OT_CROSS_MIDNIGHT_CUTOFF;

const getFixedShiftPolicy = (scheduleType) => FIXED_SHIFT_OT_POLICIES[scheduleType] ?? null;

const resolveOtDate = (date, timeValue) => {
    if (!date || !timeValue) return null;
    if (!isCrossMidnightOt(timeValue)) return date;
    return addDaysToDate(date, 1);
};

const parseVnDateTime = (date, timeValue) => {
    if (!date || !timeValue) return null;
    const parsed = new Date(`${date}T${timeValue}:00+07:00`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatMinutes = (minutes) => {
    if (!Number.isFinite(minutes) || minutes <= 0) return '0 phút';
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours <= 0) return `${mins} phút`;
    return `${hours} giờ ${mins} phút`;
};

/**
 * Form for creating OT_REQUEST requests, including confirm modal flow.
 */
export default function OtRequestForm({
    formData,
    onFieldChange,
    onSuccess,
    setFormError,
    setFormSuccess,
}) {
    const today = new Date().toLocaleDateString('sv-SE', {
        timeZone: 'Asia/Ho_Chi_Minh',
    });

    const [submitting, setSubmitting] = useState(false);
    const [showOtConfirmModal, setShowOtConfirmModal] = useState(false);
    const [estimatedOtMinutes, setEstimatedOtMinutes] = useState(null);
    const [modalError, setModalError] = useState('');
    const [scheduleItemsByDate, setScheduleItemsByDate] = useState({});

    const otMode = formData.otMode || OT_MODE_CONTINUOUS;
    const selectedScheduleItem = formData.date ? scheduleItemsByDate[formData.date] || null : null;
    const selectedFixedShiftPolicy = getFixedShiftPolicy(selectedScheduleItem?.scheduleType);

    useEffect(() => {
        let active = true;

        getMyWorkSchedules()
            .then(({ data }) => {
                if (!active) return;

                const nextItemsByDate = {};
                const items = Array.isArray(data?.items) ? data.items : [];
                items.forEach((item) => {
                    if (item?.workDate) {
                        nextItemsByDate[item.workDate] = item;
                    }
                });
                setScheduleItemsByDate(nextItemsByDate);
            })
            .catch(() => {
                if (active) {
                    setScheduleItemsByDate({});
                }
            });

        return () => {
            active = false;
        };
    }, []);

    const handleInputChange = (e) => {
        const { name, value } = e.target;

        if (name === 'otMode') {
            onFieldChange('otMode', value);
            if (value === OT_MODE_CONTINUOUS) {
                onFieldChange('otStartTime', '');
            }
            return;
        }

        onFieldChange(name, value);
    };

    const getPreviewRange = () => {
        const { date, estimatedEndTime, otStartTime } = formData;
        if (!date || !estimatedEndTime) {
            return { start: null, end: null, minutes: 0, endDate: null, startDate: null };
        }

        const endDate = resolveOtDate(date, estimatedEndTime);
        const end = parseVnDateTime(endDate, estimatedEndTime);
        if (!end) {
            return { start: null, end: null, minutes: 0, endDate, startDate: null };
        }

        if (otMode === OT_MODE_SEPARATED) {
            if (!otStartTime) {
                return { start: null, end, minutes: 0, endDate, startDate: null };
            }
            const startDate = resolveOtDate(date, otStartTime);
            const start = parseVnDateTime(startDate, otStartTime);
            if (!start) {
                return { start: null, end, minutes: 0, endDate, startDate };
            }
            const minutes = Math.floor((end - start) / 60000);
            return {
                start,
                end,
                minutes: Number.isFinite(minutes) ? minutes : 0,
                endDate,
                startDate,
            };
        }

        if (!selectedFixedShiftPolicy) {
            return { start: null, end, minutes: null, endDate, startDate: date };
        }

        const start = parseVnDateTime(date, selectedFixedShiftPolicy.threshold);
        const minutes = Math.floor((end - start) / 60000);
        return {
            start,
            end,
            minutes: Number.isFinite(minutes) ? minutes : null,
            endDate,
            startDate: date,
        };
    };

    const validateOtRequest = () => {
        const { date, estimatedEndTime, reason, otStartTime } = formData;

        if (!date) return { valid: false, error: 'Vui lòng chọn ngày làm OT' };
        if (!estimatedEndTime) return { valid: false, error: 'Vui lòng nhập giờ kết thúc OT' };
        if (!reason?.trim()) return { valid: false, error: 'Vui lòng nhập lý do' };

        const todayStr = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
        if (date < todayStr) {
            return { valid: false, error: 'Không thể đăng ký OT cho ngày trong quá khứ' };
        }

        if (![OT_MODE_CONTINUOUS, OT_MODE_SEPARATED].includes(otMode)) {
            return { valid: false, error: 'Loại OT không hợp lệ' };
        }

        const endDate = resolveOtDate(date, estimatedEndTime);
        const endTime = parseVnDateTime(endDate, estimatedEndTime);
        if (!endTime) {
            return { valid: false, error: 'Giờ kết thúc OT không hợp lệ' };
        }

        if (date === todayStr && endTime <= new Date()) {
            return {
                valid: false,
                error: 'Giờ kết thúc OT phải sau thời điểm hiện tại',
            };
        }

        if (selectedScheduleItem?.scheduleType === 'FLEXIBLE' && selectedScheduleItem?.isWorkday) {
            return {
                valid: false,
                error: 'Lịch Linh hoạt trong ngày làm việc hiện không hỗ trợ đăng ký OT',
            };
        }

        if (otMode === OT_MODE_CONTINUOUS) {
            if (
                selectedFixedShiftPolicy &&
                !isCrossMidnightOt(estimatedEndTime) &&
                estimatedEndTime < selectedFixedShiftPolicy.threshold
            ) {
                return {
                    valid: false,
                    error: `OT liên tục không thể kết thúc trước ${selectedFixedShiftPolicy.threshold} (GMT+7)`,
                };
            }

            const continuousStart = selectedFixedShiftPolicy
                ? parseVnDateTime(date, selectedFixedShiftPolicy.threshold)
                : null;
            const minutes = continuousStart
                ? Math.floor((endTime - continuousStart) / 60000)
                : null;
            if (Number.isFinite(minutes) && minutes < 30) {
                return { valid: false, error: 'Thời gian OT tối thiểu là 30 phút' };
            }

            return {
                valid: true,
                error: '',
                otMinutes: Number.isFinite(minutes) ? minutes : null,
                endOffsetDays: isCrossMidnightOt(estimatedEndTime) ? 1 : 0,
                otStartOffsetDays: 0,
            };
        }

        // SEPARATED mode validations
        if (date !== todayStr) {
            return { valid: false, error: 'OT tách rời chỉ hỗ trợ đăng ký cho ngày hiện tại (GMT+7)' };
        }

        if (!otStartTime) {
            return { valid: false, error: 'Vui lòng nhập giờ bắt đầu OT tách rời' };
        }

        const startDate = resolveOtDate(date, otStartTime);
        const startTime = parseVnDateTime(startDate, otStartTime);
        if (!startTime) {
            return { valid: false, error: 'Giờ bắt đầu OT không hợp lệ' };
        }

        const threshold = selectedFixedShiftPolicy
            ? parseVnDateTime(date, selectedFixedShiftPolicy.threshold)
            : null;
        if (threshold && startTime < threshold) {
            return {
                valid: false,
                error: `Giờ bắt đầu OT tách rời phải từ ${selectedFixedShiftPolicy.threshold} (GMT+7)`,
            };
        }

        if (endTime <= startTime) {
            return { valid: false, error: 'Giờ kết thúc phải sau giờ bắt đầu OT' };
        }

        const minutes = Math.floor((endTime - startTime) / 60000);
        if (minutes < 30) {
            return { valid: false, error: 'Thời gian OT tối thiểu là 30 phút' };
        }

        if (isCrossMidnightOt(otStartTime) && otStartTime >= OT_CROSS_MIDNIGHT_CUTOFF) {
            return { valid: false, error: 'Giờ bắt đầu OT qua đêm phải trước 08:00' };
        }

        if (isCrossMidnightOt(estimatedEndTime) && estimatedEndTime >= OT_CROSS_MIDNIGHT_CUTOFF) {
            return { valid: false, error: 'Giờ kết thúc OT qua đêm phải trước 08:00' };
        }

        return {
            valid: true,
            error: '',
            otMinutes: minutes,
            endOffsetDays: isCrossMidnightOt(estimatedEndTime) ? 1 : 0,
            otStartOffsetDays: isCrossMidnightOt(otStartTime) ? 1 : 0,
        };
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        if (submitting) return;

        setFormError('');
        setFormSuccess('');
        setModalError('');

        const validation = validateOtRequest();
        if (!validation.valid) {
            setFormError(validation.error);
            return;
        }

        setEstimatedOtMinutes(validation.otMinutes ?? null);
        setShowOtConfirmModal(true);
    };

    const handleConfirmOtRequest = async () => {
        setSubmitting(true);
        setModalError('');

        try {
            const endOffsetDays = isCrossMidnightOt(formData.estimatedEndTime) ? 1 : 0;
            const separatedStartOffsetDays =
                otMode === OT_MODE_SEPARATED && isCrossMidnightOt(formData.otStartTime)
                    ? 1
                    : 0;

            const payload = {
                type: 'OT_REQUEST',
                date: formData.date,
                otMode,
                estimatedEndTime: buildIsoTimestamp(
                    formData.date,
                    formData.estimatedEndTime,
                    endOffsetDays
                ),
                reason: formData.reason.trim(),
            };

            if (otMode === OT_MODE_SEPARATED) {
                payload.otStartTime = buildIsoTimestamp(
                    formData.date,
                    formData.otStartTime,
                    separatedStartOffsetDays
                );
            }

            await createRequest(payload);

            setFormSuccess('Đã gửi yêu cầu OT thành công!');
            setShowOtConfirmModal(false);
            onSuccess?.();
        } catch (err) {
            const errorMsg = err.response?.data?.message || 'Không thể tạo yêu cầu OT';
            setModalError(errorMsg);
        } finally {
            setSubmitting(false);
        }
    };

    const preview = getPreviewRange();
    const isCrossDayOt = isCrossMidnightOt(formData.estimatedEndTime);
    const nextDayDisplay = isCrossDayOt && formData.date ? getNextDayDisplay(formData.date) : '';
    const isSeparated = otMode === OT_MODE_SEPARATED;
    const scheduleHelperText = (() => {
        if (selectedFixedShiftPolicy) {
            return `${selectedFixedShiftPolicy.label}: OT bắt đầu từ ${selectedFixedShiftPolicy.threshold}, tối thiểu cùng ngày đến ${selectedFixedShiftPolicy.earliestEnd}.`;
        }

        if (selectedScheduleItem?.scheduleType === 'FLEXIBLE' && selectedScheduleItem?.isWorkday) {
            return 'Lịch Linh hoạt trong ngày làm việc hiện không hỗ trợ OT cố định.';
        }

        return 'Hệ thống sẽ đối chiếu theo ca đã đăng ký của ngày này khi tạo yêu cầu.';
    })();

    return (
        <>
            <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-4 p-4 bg-purple-50 border border-purple-200 rounded-lg">
                    <div className="flex items-center space-x-2 mb-2">
                        <svg className="w-5 h-5 text-purple-600" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
                        </svg>
                        <h3 className="font-semibold text-purple-900">Đăng ký làm thêm giờ (OT)</h3>
                    </div>

                    <div>
                        <Label htmlFor="ot-mode" value="Loại OT *" />
                        <Select
                            id="ot-mode"
                            name="otMode"
                            value={otMode}
                            onChange={handleInputChange}
                            required
                        >
                            <option value={OT_MODE_CONTINUOUS}>Làm thêm liên tục</option>
                            <option value={OT_MODE_SEPARATED}>Phiên tách rời</option>
                        </Select>
                    </div>

                    <div>
                        <Label htmlFor="ot-date" value="Ngày làm OT *" />
                        <TextInput
                            id="ot-date"
                            name="date"
                            type="date"
                            value={formData.date}
                            onChange={handleInputChange}
                            min={today}
                            required
                        />
                            <p className="text-xs text-gray-600 mt-1">
                                {isSeparated
                                    ? 'OT tách rời chỉ hỗ trợ ngày hiện tại (GMT+7), sau khi đã check-in và check-out ca chính'
                                    : 'OT liên tục hỗ trợ ngày hiện tại hoặc tương lai'}
                            </p>
                            <p className="text-xs text-gray-600 mt-1">{scheduleHelperText}</p>
                        </div>

                    {isSeparated && (
                        <div>
                            <Label htmlFor="ot-start-time" value="Giờ bắt đầu OT *" />
                            <TextInput
                                id="ot-start-time"
                                name="otStartTime"
                                type="time"
                                value={formData.otStartTime || ''}
                                onChange={handleInputChange}
                                required={isSeparated}
                            />
                            <div className="text-xs text-gray-600 mt-1 space-y-1">
                                <p>
                                    {selectedFixedShiftPolicy
                                        ? `Giờ bắt đầu phải từ ${selectedFixedShiftPolicy.threshold} (GMT+7)`
                                        : 'Giờ bắt đầu sẽ được kiểm tra theo ca đã đăng ký'}
                                </p>
                                <p>Giờ 00:00-07:59 sẽ được tính là ngày hôm sau</p>
                            </div>
                        </div>
                    )}

                    <div>
                        <Label htmlFor="ot-time" value="Giờ kết thúc OT *" />
                        <TextInput
                            id="ot-time"
                            name="estimatedEndTime"
                            type="time"
                            value={formData.estimatedEndTime}
                            onChange={handleInputChange}
                            required
                        />
                        <div className="text-xs text-gray-600 mt-1 space-y-1">
                            {!isSeparated && (
                                <p>
                                    {selectedFixedShiftPolicy
                                        ? `OT liên tục cùng ngày tối thiểu đến ${selectedFixedShiftPolicy.earliestEnd}`
                                        : 'OT liên tục cùng ngày sẽ được đối chiếu theo ca đã đăng ký'}
                                </p>
                            )}
                            <p>Giờ 00:00-07:59 sẽ được tính là ngày hôm sau</p>
                            <p>Tối thiểu 30 phút</p>
                        </div>
                        {formData.date && isCrossDayOt && (
                            <p className="text-xs text-indigo-600 mt-1">
                                Giờ kết thúc sẽ tính là ngày hôm sau ({nextDayDisplay})
                            </p>
                        )}
                    </div>

                    {formData.date && formData.estimatedEndTime && Number.isFinite(preview.minutes) && preview.minutes > 0 && (
                        <Alert color={preview.minutes >= 30 ? 'success' : 'warning'}>
                            <div className="flex items-center">
                                <span className="font-semibold mr-2">Thời gian OT dự kiến:</span>
                                <span className="text-lg">{formatMinutes(preview.minutes)}</span>
                                {preview.minutes < 30 && (
                                    <span className="ml-2 text-sm">(Tối thiểu 30 phút)</span>
                                )}
                            </div>
                        </Alert>
                    )}

                    <div>
                        <Label htmlFor="ot-reason" value="Lý do *" />
                        <Textarea
                            id="ot-reason"
                            name="reason"
                            value={formData.reason}
                            onChange={handleInputChange}
                            placeholder="Ví dụ: Deploy production, Fix critical bug..."
                            rows={3}
                            required
                        />
                    </div>

                    <Alert color="warning">
                        <div className="text-sm">
                            <p className="font-semibold mb-1">Lưu ý:</p>
                            <ul className="list-disc list-inside space-y-1 text-xs">
                                {isSeparated ? (
                                    <>
                                        <li>Phải hoàn tất check-in và check-out ca chính trước khi đăng ký</li>
                                        <li>Giờ bắt đầu OT phải sau thời điểm check-out ca chính</li>
                                        <li>Yêu cầu vẫn cần manager phê duyệt</li>
                                    </>
                                ) : (
                                    <>
                                        <li>Phải có approval từ manager trước khi checkout</li>
                                        <li>Nếu không có approval: giờ làm chỉ tính trong khung ca đã đăng ký, OT = 0</li>
                                    </>
                                )}
                            </ul>
                        </div>
                    </Alert>
                </div>

                <Button type="submit" disabled={submitting} color="cyan">
                    {submitting ? <Spinner size="sm" className="mr-2" /> : <HiPlus className="mr-2" />}
                    Tạo yêu cầu
                </Button>
            </form>

            <Modal
                show={showOtConfirmModal}
                onClose={() => !submitting && setShowOtConfirmModal(false)}
                size="lg"
            >
                <Modal.Header>
                    <div className="flex items-center space-x-2">
                        <svg className="w-6 h-6 text-purple-600" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
                        </svg>
                        <span>Xác nhận đăng ký OT</span>
                    </div>
                </Modal.Header>

                <Modal.Body>
                    <div className="space-y-4">
                        <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                            <h3 className="font-semibold text-purple-900 mb-3">
                                Thông tin đăng ký OT
                            </h3>

                            <div className="space-y-2">
                                <div className="flex justify-between">
                                    <span className="text-gray-600">Loại OT:</span>
                                    <span className="font-medium">
                                        {isSeparated ? 'Phiên tách rời' : 'Làm thêm liên tục'}
                                    </span>
                                </div>

                                <div className="flex justify-between">
                                    <span className="text-gray-600">Ngày:</span>
                                    <span className="font-medium">
                                        {new Date(formData.date + 'T00:00:00+07:00').toLocaleDateString('vi-VN')}
                                    </span>
                                </div>

                                {isSeparated && (
                                    <div className="flex justify-between">
                                        <span className="text-gray-600">Bắt đầu OT:</span>
                                        <span className="font-medium">
                                            {formData.otStartTime}
                                            {isCrossMidnightOt(formData.otStartTime) && nextDayDisplay && ` (ngày ${nextDayDisplay})`}
                                        </span>
                                    </div>
                                )}

                                <div className="flex justify-between">
                                    <span className="text-gray-600">Kết thúc OT:</span>
                                    <span className="font-medium">
                                        {formData.estimatedEndTime}
                                        {isCrossDayOt && nextDayDisplay && ` (ngày ${nextDayDisplay})`}
                                    </span>
                                </div>

                                <div className="flex justify-between bg-green-50 rounded p-2">
                                    <span className="text-gray-600">Thời gian OT:</span>
                                    <span className="font-bold text-green-600">
                                        {Number.isFinite(estimatedOtMinutes)
                                            ? formatMinutes(estimatedOtMinutes)
                                            : 'Sẽ được xác định theo ca đã đăng ký'}
                                    </span>
                                </div>

                                <div className="pt-2 border-t">
                                    <span className="text-gray-600 block mb-1">Lý do:</span>
                                    <p className="font-medium bg-white p-2 rounded border">
                                        {formData.reason}
                                    </p>
                                </div>
                            </div>
                        </div>

                        {modalError && (
                            <Alert color="failure">
                                {modalError}
                            </Alert>
                        )}

                        <Alert color="warning">
                            <div className="text-sm">
                                <p className="font-semibold mb-1">Lưu ý:</p>
                                <ul className="list-disc list-inside space-y-1 text-xs">
                                    <li>Yêu cầu OT cần quản lý phê duyệt</li>
                                    {isSeparated ? (
                                        <li>OT tách rời chỉ hợp lệ sau khi đã hoàn tất ca chính</li>
                                    ) : (
                                        <li>OT liên tục cần tạo trước khi checkout</li>
                                    )}
                                </ul>
                            </div>
                        </Alert>
                    </div>
                </Modal.Body>

                <Modal.Footer>
                    <Button
                        onClick={handleConfirmOtRequest}
                        disabled={submitting}
                        color="purple"
                    >
                        {submitting ? (
                            <>
                                <Spinner size="sm" className="mr-2" />
                                Đang gửi...
                            </>
                        ) : (
                            'Xác nhận gửi'
                        )}
                    </Button>

                    <Button
                        color="gray"
                        onClick={() => setShowOtConfirmModal(false)}
                        disabled={submitting}
                    >
                        Hủy
                    </Button>
                </Modal.Footer>
            </Modal>
        </>
    );
}
