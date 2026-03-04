import { useState } from 'react';
import {
    Card,
    Label,
    Alert,
    Select,
} from 'flowbite-react';
import AdjustTimeForm from './AdjustTimeForm';
import LeaveRequestForm from './LeaveRequestForm';
import OtRequestForm from './OtRequestForm';

const getTodayInVn = () => new Date().toLocaleDateString('sv-SE', {
    timeZone: 'Asia/Ho_Chi_Minh',
});

const createInitialDraft = (today) => ({
    requestType: 'ADJUST_TIME',
    date: today,
    checkInTime: '',
    checkOutTime: '',
    leaveStartDate: today,
    leaveEndDate: today,
    leaveType: 'ANNUAL',
    reason: '',
    estimatedEndTime: '',
    otMode: 'CONTINUOUS',
    otStartTime: '',
});

/**
 * Apply legacy request-type switch behavior from the pre-split form.
 * Keeps shared reason field while clearing type-specific fields.
 */
const applyTypeSwitch = (prevDraft, nextType, today) => {
    if (nextType === 'LEAVE') {
        return {
            ...prevDraft,
            requestType: nextType,
            checkInTime: '',
            checkOutTime: '',
            estimatedEndTime: '',
            otMode: 'CONTINUOUS',
            otStartTime: '',
        };
    }

    if (nextType === 'OT_REQUEST') {
        return {
            ...prevDraft,
            requestType: nextType,
            date: today,
            checkInTime: '',
            checkOutTime: '',
            leaveStartDate: today,
            leaveEndDate: today,
            leaveType: 'ANNUAL',
            estimatedEndTime: '',
            otMode: 'CONTINUOUS',
            otStartTime: '',
        };
    }

    return {
        ...prevDraft,
        requestType: 'ADJUST_TIME',
        leaveStartDate: today,
        leaveEndDate: today,
        leaveType: 'ANNUAL',
        estimatedEndTime: '',
        otMode: 'CONTINUOUS',
        otStartTime: '',
    };
};

/**
 * Wrapper form for creating attendance requests.
 * Owns the request-type selector and renders the appropriate child form.
 * Child forms own type-specific state and submit logic.
 *
 * Post-success default behavior: wrapper resets selection to ADJUST_TIME.
 *
 * @param {Object} props
 * @param {Function} props.onSuccess - Called after successful creation
 */
export default function CreateRequestForm({ onSuccess }) {
    const today = getTodayInVn();
    const [draft, setDraft] = useState(() => createInitialDraft(today));
    const [formError, setFormError] = useState('');
    const [formSuccess, setFormSuccess] = useState('');
    const [isNextDayCheckout, setIsNextDayCheckout] = useState(false);

    // Clear messages and reset to ADJUST_TIME after any child succeeds
    const handleChildSuccess = () => {
        setDraft(createInitialDraft(today));
        setIsNextDayCheckout(false);
        onSuccess?.();
    };

    const handleFieldChange = (name, value) => {
        setDraft((prev) => ({ ...prev, [name]: value }));
    };

    // Clear messages when switching type
    const handleTypeChange = (e) => {
        const nextType = e.target.value;
        setFormError('');
        setFormSuccess('');
        setIsNextDayCheckout(false);
        setDraft((prev) => applyTypeSwitch(prev, nextType, today));
    };

    return (
        <Card>
            <h2 className="text-lg font-semibold text-gray-700 mb-4">Tạo yêu cầu mới</h2>

            {formError && (
                <Alert color="failure" className="mb-4" onDismiss={() => setFormError('')}>
                    {formError}
                </Alert>
            )}
            {formSuccess && (
                <Alert color="success" className="mb-4" onDismiss={() => setFormSuccess('')}>
                    {formSuccess}
                </Alert>
            )}

            {/* Type Selector */}
            <div className="mb-4">
                <Label htmlFor="requestType" value="Loại yêu cầu *" />
                <Select
                    id="requestType"
                    name="requestType"
                    value={draft.requestType}
                    onChange={handleTypeChange}
                    required
                >
                    <option value="ADJUST_TIME">Điều chỉnh giờ</option>
                    <option value="LEAVE">Nghỉ phép</option>
                    <option value="OT_REQUEST">Đăng ký OT</option>
                </Select>
            </div>

            {/* Render the active child form */}
            {draft.requestType === 'ADJUST_TIME' && (
                <AdjustTimeForm
                    formData={draft}
                    onFieldChange={handleFieldChange}
                    isNextDayCheckout={isNextDayCheckout}
                    setIsNextDayCheckout={setIsNextDayCheckout}
                    onSuccess={handleChildSuccess}
                    setFormError={setFormError}
                    setFormSuccess={setFormSuccess}
                />
            )}
            {draft.requestType === 'LEAVE' && (
                <LeaveRequestForm
                    formData={draft}
                    onFieldChange={handleFieldChange}
                    onSuccess={handleChildSuccess}
                    setFormError={setFormError}
                    setFormSuccess={setFormSuccess}
                />
            )}
            {draft.requestType === 'OT_REQUEST' && (
                <OtRequestForm
                    formData={draft}
                    onFieldChange={handleFieldChange}
                    onSuccess={handleChildSuccess}
                    setFormError={setFormError}
                    setFormSuccess={setFormSuccess}
                />
            )}
        </Card>
    );
}
