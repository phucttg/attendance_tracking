import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import LeaveRequestForm from '../../src/components/requests/LeaveRequestForm';
import { createRequest } from '../../src/api/requestApi';

vi.mock('../../src/api/requestApi', () => ({
    createRequest: vi.fn(),
}));

const baseFormData = {
    leaveStartDate: '2099-03-02',
    leaveEndDate: '2099-03-02',
    reason: '',
};

function TestHarness({ initialData = baseFormData }) {
    const [formData, setFormData] = useState(initialData);
    const [formError, setFormError] = useState('');
    const [formSuccess, setFormSuccess] = useState('');

    return (
        <div>
            {formError && <div data-testid="form-error">{formError}</div>}
            {formSuccess && <div data-testid="form-success">{formSuccess}</div>}
            <LeaveRequestForm
                formData={formData}
                onFieldChange={(name, value) => setFormData((prev) => ({ ...prev, [name]: value }))}
                onSuccess={vi.fn()}
                setFormError={setFormError}
                setFormSuccess={setFormSuccess}
            />
        </div>
    );
}

describe('LeaveRequestForm', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        createRequest.mockResolvedValue({ data: { request: { _id: 'leave-1' } } });
    });

    it('does not render leave type field', () => {
        render(<TestHarness />);

        expect(screen.queryByLabelText(/loại nghỉ/i)).not.toBeInTheDocument();
    });

    it('submits LEAVE payload without leaveType', async () => {
        const user = userEvent.setup();
        render(<TestHarness />);

        await user.type(screen.getByLabelText(/lý do/i), 'Nghỉ việc cá nhân');
        await user.click(screen.getByRole('button', { name: 'Tạo yêu cầu' }));

        await waitFor(() => {
            expect(createRequest).toHaveBeenCalledWith({
                type: 'LEAVE',
                reason: 'Nghỉ việc cá nhân',
                leaveStartDate: '2099-03-02',
                leaveEndDate: '2099-03-02',
            });
        });
    });

    it('requires a reason', async () => {
        const { container } = render(<TestHarness />);

        fireEvent.submit(container.querySelector('form'));

        expect(screen.getByTestId('form-error')).toHaveTextContent('Vui lòng nhập lý do');
        expect(createRequest).not.toHaveBeenCalled();
    });

    it('rejects an end date before the start date', async () => {
        const user = userEvent.setup();
        render(
            <TestHarness
                initialData={{
                    leaveStartDate: '2099-03-05',
                    leaveEndDate: '2099-03-04',
                    reason: 'Nghỉ việc cá nhân',
                }}
            />
        );

        await user.click(screen.getByRole('button', { name: 'Tạo yêu cầu' }));

        expect(screen.getByTestId('form-error')).toHaveTextContent(
            'Ngày kết thúc phải sau hoặc bằng ngày bắt đầu'
        );
        expect(createRequest).not.toHaveBeenCalled();
    });

    it('marks leave date inputs as required', () => {
        render(<TestHarness />);

        expect(screen.getByLabelText(/từ ngày/i)).toBeRequired();
        expect(screen.getByLabelText(/đến ngày/i)).toBeRequired();
    });
});
