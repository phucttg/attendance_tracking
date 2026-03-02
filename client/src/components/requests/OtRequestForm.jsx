import { useState } from 'react';
import {
    Label,
    TextInput,
    Textarea,
    Button,
    Spinner,
    Alert,
    Modal,
} from 'flowbite-react';
import { HiPlus } from 'react-icons/hi';
import { createRequest } from '../../api/requestApi';
import {
    addDaysToDate,
    buildIsoTimestamp,
    getNextDayDisplay,
} from '../../utils/dateDisplay';

const OT_CROSS_MIDNIGHT_CUTOFF = '08:00';

const isCrossMidnightOt = (estimatedEndTime) =>
    Boolean(estimatedEndTime) && estimatedEndTime < OT_CROSS_MIDNIGHT_CUTOFF;

const resolveOtEndDate = (date, estimatedEndTime) => {
    if (!date || !estimatedEndTime) return null;
    if (!isCrossMidnightOt(estimatedEndTime)) return date;
    return addDaysToDate(date, 1);
};

/**
 * Form for creating OT_REQUEST requests, including confirm modal flow.
 * Extracted from CreateRequestForm.jsx (Option B wrapper pattern).
 *
 * @param {Object} props
 * @param {Object} props.formData - Canonical wrapper draft state
 * @param {Function} props.onFieldChange - Update wrapper draft field
 * @param {Function} props.onSuccess - Called after successful creation
 * @param {Function} props.setFormError - Set error message on parent
 * @param {Function} props.setFormSuccess - Set success message on parent
 */
export default function OtRequestForm({
    formData,
    onFieldChange,
    onSuccess,
    setFormError,
    setFormSuccess,
}) {
    // Get today in GMT+7 for default date
    const today = new Date().toLocaleDateString('sv-SE', {
        timeZone: 'Asia/Ho_Chi_Minh',
    });

    const [submitting, setSubmitting] = useState(false);
    // OT modal state
    const [showOtConfirmModal, setShowOtConfirmModal] = useState(false);
    const [estimatedOtMinutes, setEstimatedOtMinutes] = useState(0);
    // Local modal-level error (not propagated to wrapper)
    const [modalError, setModalError] = useState('');

    const handleInputChange = (e) => {
        const { name, value } = e.target;
        onFieldChange(name, value);
    };

    /**
     * Validate OT request business rules.
     * REUSES buildIsoTimestamp helper.
     */
    const validateOtRequest = () => {
        const { date, estimatedEndTime, reason } = formData;

        // Required fields
        if (!date) return { valid: false, error: 'Vui lòng chọn ngày làm OT' };
        if (!estimatedEndTime) return { valid: false, error: 'Vui lòng nhập giờ về dự kiến' };
        if (!reason?.trim()) return { valid: false, error: 'Vui lòng nhập lý do' };

        // E1: No retroactive (date check)
        const todayStr = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
        if (date < todayStr) {
            return { valid: false, error: 'Không thể đăng ký OT cho ngày trong quá khứ' };
        }

        // E1.5: Same-day retroactive time check (CRITICAL - matches backend validation)
        if (date === todayStr) {
            const now = new Date();
            const targetDate = resolveOtEndDate(date, estimatedEndTime);
            if (!targetDate) {
                return { valid: false, error: 'Ngày hoặc giờ không hợp lệ' };
            }
            const estimatedTime = new Date(`${targetDate}T${estimatedEndTime}:00+07:00`);
            if (isNaN(estimatedTime.getTime())) {
                return { valid: false, error: 'Ngày hoặc giờ không hợp lệ' };
            }

            if (estimatedTime <= now) {
                return {
                    valid: false,
                    error: 'Giờ về dự kiến phải sau thời điểm hiện tại. Không thể đăng ký OT đã qua.',
                };
            }
        }

        // D1: Must be after 17:31
        const isCrossDay = isCrossMidnightOt(estimatedEndTime);
        if (!isCrossDay && estimatedEndTime <= '17:31') {
            return { valid: false, error: 'Giờ về phải sau 17:31 (hết giờ làm việc)' };
        }

        // D1: Minimum 30 minutes
        try {
            const targetDate = resolveOtEndDate(date, estimatedEndTime);
            if (!targetDate) {
                return { valid: false, error: 'Ngày hoặc giờ không hợp lệ' };
            }
            const otStart = new Date(`${date}T17:31:00+07:00`);
            const otEnd = new Date(`${targetDate}T${estimatedEndTime}:00+07:00`);
            if (isNaN(otStart.getTime()) || isNaN(otEnd.getTime())) {
                return { valid: false, error: 'Ngày hoặc giờ không hợp lệ' };
            }
            const diffMinutes = Math.floor((otEnd - otStart) / 60000);

            if (diffMinutes < 30) {
                return { valid: false, error: 'Thời gian OT tối thiểu là 30 phút (từ 18:01 trở đi)' };
            }

            return { valid: true, error: '', otMinutes: diffMinutes };
        } catch (err) {
            return { valid: false, error: 'Ngày hoặc giờ không hợp lệ' };
        }
    };

    // Handle form submit — validate then show confirm modal
    const handleSubmit = (e) => {
        e.preventDefault();

        // Double-submit guard
        if (submitting) return;

        setFormError('');
        setFormSuccess('');
        setModalError('');

        const validation = validateOtRequest();

        if (!validation.valid) {
            setFormError(validation.error);
            return;
        }

        // Clear form error before opening modal
        setFormError('');

        // Show confirmation modal (J2 requirement)
        setEstimatedOtMinutes(validation.otMinutes);
        setShowOtConfirmModal(true);
    };

    /**
     * Handle OT confirmation from modal.
     * REUSES buildIsoTimestamp helper.
     */
    const handleConfirmOtRequest = async () => {
        setSubmitting(true);
        setModalError('');

        try {
            const isCrossDay = isCrossMidnightOt(formData.estimatedEndTime);
            const payload = {
                type: 'OT_REQUEST',
                date: formData.date,
                estimatedEndTime: buildIsoTimestamp(
                    formData.date,
                    formData.estimatedEndTime,
                    isCrossDay ? 1 : 0
                ),
                reason: formData.reason.trim(),
            };

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

    const isCrossDayOt = isCrossMidnightOt(formData.estimatedEndTime);
    const nextDayDisplay = isCrossDayOt && formData.date ? getNextDayDisplay(formData.date) : '';

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

                    {/* Date Field */}
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
                            Chỉ có thể đăng ký cho ngày hôm nay hoặc tương lai
                        </p>
                    </div>

                    {/* Estimated End Time */}
                    <div>
                        <Label htmlFor="ot-time" value="Dự kiến giờ về *" />
                        <TextInput
                            id="ot-time"
                            name="estimatedEndTime"
                            type="time"
                            value={formData.estimatedEndTime}
                            onChange={handleInputChange}
                            required
                        />
                        <div className="text-xs text-gray-600 mt-1 space-y-1">
                            <p>Giờ cùng ngày phải sau 17:31 (hết giờ làm việc)</p>
                            <p>Giờ 00:00-07:59 sẽ được tính là ngày hôm sau</p>
                            <p>Tối thiểu 30 phút OT (tức là từ 18:01 trở đi)</p>
                        </div>
                        {formData.date && isCrossDayOt && (
                            <p className="text-xs text-indigo-600 mt-1">
                                ⏰ Giờ về sẽ tính là ngày hôm sau ({nextDayDisplay})
                            </p>
                        )}
                    </div>

                    {/* Real-time OT Duration Display */}
                    {formData.date && formData.estimatedEndTime && (() => {
                        try {
                            const targetDate = resolveOtEndDate(formData.date, formData.estimatedEndTime);
                            if (!targetDate) return null;
                            const otStart = new Date(`${formData.date}T17:31:00+07:00`);
                            const otEnd = new Date(`${targetDate}T${formData.estimatedEndTime}:00+07:00`);
                            if (isNaN(otStart.getTime()) || isNaN(otEnd.getTime())) return null;
                            const minutes = Math.floor((otEnd - otStart) / 60000);

                            if (minutes > 0) {
                                const hours = Math.floor(minutes / 60);
                                const mins = minutes % 60;
                                const timeStr = hours > 0 ? `${hours} giờ ${mins} phút` : `${mins} phút`;

                                return (
                                    <Alert color={minutes >= 30 ? 'success' : 'warning'}>
                                        <div className="flex items-center">
                                            <span className="font-semibold mr-2">Thời gian OT dự kiến:</span>
                                            <span className="text-lg">{timeStr}</span>
                                            {minutes < 30 && (
                                                <span className="ml-2 text-sm">(Tối thiểu 30 phút)</span>
                                            )}
                                        </div>
                                    </Alert>
                                );
                            }
                        } catch (e) {
                            // Invalid date/time
                        }
                        return null;
                    })()}

                    {/* Reason */}
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

                    {/* Notice */}
                    <Alert color="warning">
                        <div className="text-sm">
                            <p className="font-semibold mb-1">Lưu ý:</p>
                            <ul className="list-disc list-inside space-y-1 text-xs">
                                <li>Phải có approval từ manager trước khi checkout</li>
                                <li>Nếu không có approval: giờ làm tính đến 17:30, OT = 0</li>
                                <li>Có thể hủy nếu còn ở trạng thái PENDING</li>
                            </ul>
                        </div>
                    </Alert>
                </div>

                {/* Submit */}
                <Button type="submit" disabled={submitting} color="cyan">
                    {submitting ? <Spinner size="sm" className="mr-2" /> : <HiPlus className="mr-2" />}
                    Tạo yêu cầu
                </Button>
            </form>

            {/* OT Confirmation Modal */}
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
                        {/* OT Info */}
                        <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                            <h3 className="font-semibold text-purple-900 mb-3">
                                Thông tin đăng ký OT
                            </h3>

                            <div className="space-y-2">
                                <div className="flex justify-between">
                                    <span className="text-gray-600">Ngày:</span>
                                    <span className="font-medium">
                                        {new Date(formData.date + 'T00:00:00+07:00').toLocaleDateString('vi-VN')}
                                    </span>
                                </div>

                                <div className="flex justify-between">
                                    <span className="text-gray-600">Dự kiến về:</span>
                                    <span className="font-medium">
                                        {formData.estimatedEndTime}
                                        {isCrossDayOt && nextDayDisplay && ` (ngày ${nextDayDisplay})`}
                                    </span>
                                </div>

                                <div className="flex justify-between bg-green-50 rounded p-2">
                                    <span className="text-gray-600">Thời gian OT:</span>
                                    <span className="font-bold text-green-600">
                                        {Math.floor(estimatedOtMinutes / 60) > 0 && `${Math.floor(estimatedOtMinutes / 60)} giờ `}
                                        {estimatedOtMinutes % 60} phút
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

                        {/* Error Display */}
                        {modalError && (
                            <Alert color="failure">
                                {modalError}
                            </Alert>
                        )}

                        {/* Warning */}
                        <Alert color="warning">
                            <div className="text-sm">
                                <p className="font-semibold mb-1">Lưu ý:</p>
                                <ul className="list-disc list-inside space-y-1 text-xs">
                                    <li>Yêu cầu OT cần manager phê duyệt trước checkout</li>
                                    <li>Nếu không có phê duyệt: giờ làm tính đến 17:30, OT = 0</li>
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
