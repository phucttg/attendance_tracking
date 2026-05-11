import { useState } from 'react';
import {
    Label,
    TextInput,
    Textarea,
    Button,
    Spinner,
} from 'flowbite-react';
import { HiPlus } from 'react-icons/hi';
import { createRequest } from '../../api/requestApi';

/**
 * Form for creating LEAVE requests.
 * Extracted from CreateRequestForm.jsx (Option B wrapper pattern).
 *
 * @param {Object} props
 * @param {Object} props.formData - Canonical wrapper draft state
 * @param {Function} props.onFieldChange - Update wrapper draft field
 * @param {Function} props.onSuccess - Called after successful creation
 * @param {Function} props.setFormError - Set error message on parent
 * @param {Function} props.setFormSuccess - Set success message on parent
 */
export default function LeaveRequestForm({
    formData,
    onFieldChange,
    onSuccess,
    setFormError,
    setFormSuccess,
}) {
    const [submitting, setSubmitting] = useState(false);

    const handleInputChange = (e) => {
        const { name, value } = e.target;
        onFieldChange(name, value);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        // Double-submit guard
        if (submitting) return;

        setFormError('');
        setFormSuccess('');

        // Validation: reason
        if (!formData.reason.trim()) {
            setFormError('Vui lòng nhập lý do');
            return;
        }
        if (formData.reason.trim().length > 1000) {
            setFormError('Lý do không được quá 1000 ký tự');
            return;
        }

        // LEAVE validations
        if (!formData.leaveStartDate || !formData.leaveEndDate) {
            setFormError('Vui lòng chọn ngày bắt đầu và kết thúc');
            return;
        }
        if (formData.leaveStartDate > formData.leaveEndDate) {
            setFormError('Ngày kết thúc phải sau hoặc bằng ngày bắt đầu');
            return;
        }
        // P1: Max 30 days validation (timezone-safe calculation)
        const toUtcDay = (dateStr) => {
            const [y, m, d] = dateStr.split('-').map(Number);
            return Date.UTC(y, m - 1, d);
        };
        const diffDays = Math.floor(
            (toUtcDay(formData.leaveEndDate) - toUtcDay(formData.leaveStartDate)) / 86400000
        ) + 1;
        if (diffDays > 30) {
            setFormError('Khoảng nghỉ không được vượt quá 30 ngày');
            return;
        }

        setSubmitting(true);
        try {
            const payload = {
                type: 'LEAVE',
                reason: formData.reason.trim(),
                leaveStartDate: formData.leaveStartDate,
                leaveEndDate: formData.leaveEndDate,
            };

            await createRequest(payload);
            setFormSuccess('Đã tạo yêu cầu thành công!');

            onSuccess?.();
        } catch (err) {
            const backendMsg = err.response?.data?.message;
            if (err.response?.status === 409) {
                if (backendMsg) {
                    setFormError(backendMsg);
                } else {
                    setFormError('Yêu cầu bị trùng hoặc chồng lấn với yêu cầu khác.');
                }
            } else {
                setFormError(backendMsg || 'Tạo yêu cầu thất bại');
            }
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Leave Start Date */}
                <div>
                    <Label htmlFor="leaveStartDate" value="Từ ngày *" />
                    <TextInput
                        id="leaveStartDate"
                        name="leaveStartDate"
                        type="date"
                        value={formData.leaveStartDate}
                        onChange={handleInputChange}
                        required
                    />
                </div>

                {/* Leave End Date */}
                <div>
                    <Label htmlFor="leaveEndDate" value="Đến ngày *" />
                    <TextInput
                        id="leaveEndDate"
                        name="leaveEndDate"
                        type="date"
                        value={formData.leaveEndDate}
                        onChange={handleInputChange}
                        required
                    />
                </div>
            </div>

            {/* Reason */}
            <div>
                <Label htmlFor="reason" value="Lý do *" />
                <Textarea
                    id="reason"
                    name="reason"
                    value={formData.reason}
                    onChange={handleInputChange}
                    placeholder="Nhập lý do nghỉ phép..."
                    rows={3}
                    maxLength={1000}
                    required
                />
                <p className="text-xs text-gray-500 mt-1">
                    {formData.reason.length}/1000 ký tự
                </p>
            </div>

            {/* Submit */}
            <Button type="submit" disabled={submitting} color="cyan">
                {submitting ? <Spinner size="sm" className="mr-2" /> : <HiPlus className="mr-2" />}
                Tạo yêu cầu
            </Button>
        </form>
    );
}
