import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import OtRequestForm from '../../src/components/requests/OtRequestForm';
import { createRequest } from '../../src/api/requestApi';

vi.mock('../../src/api/requestApi', () => ({
    createRequest: vi.fn(),
}));

const defaultFormData = {
    date: '2099-03-02',
    estimatedEndTime: '',
    reason: '',
};

function TestHarness({ initialData = defaultFormData }) {
    const [formData, setFormData] = useState(initialData);
    const [formError, setFormError] = useState('');
    const [formSuccess, setFormSuccess] = useState('');

    return (
        <div>
            {formError && <div data-testid="form-error">{formError}</div>}
            {formSuccess && <div data-testid="form-success">{formSuccess}</div>}
            <OtRequestForm
                formData={formData}
                onFieldChange={(name, value) => setFormData((prev) => ({ ...prev, [name]: value }))}
                onSuccess={vi.fn()}
                setFormError={setFormError}
                setFormSuccess={setFormSuccess}
            />
        </div>
    );
}

describe('OtRequestForm - cross-midnight behavior', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        createRequest.mockResolvedValue({ data: { request: { _id: 'ot-1' } } });
    });

    it('shows next-day hint for 00:30 and 07:59, hides it at 08:00', async () => {
        render(<TestHarness />);

        const timeInput = screen.getByLabelText(/dự kiến giờ về/i);

        fireEvent.change(timeInput, { target: { value: '00:30' } });
        expect(screen.getByText(/Giờ về sẽ tính là ngày hôm sau/i)).toBeInTheDocument();

        fireEvent.change(timeInput, { target: { value: '07:59' } });
        expect(screen.getByText(/Giờ về sẽ tính là ngày hôm sau/i)).toBeInTheDocument();

        fireEvent.change(timeInput, { target: { value: '08:00' } });
        expect(screen.queryByText(/Giờ về sẽ tính là ngày hôm sau/i)).not.toBeInTheDocument();
    });

    it('calculates real-time OT duration correctly for cross-midnight 00:30', async () => {
        render(<TestHarness />);

        fireEvent.change(screen.getByLabelText(/dự kiến giờ về/i), { target: { value: '00:30' } });

        expect(screen.getByText(/Thời gian OT dự kiến:/i)).toBeInTheDocument();
        expect(screen.getByText('6 giờ 59 phút')).toBeInTheDocument();
    });

    it('submits cross-midnight payload with next-day ISO timestamp', async () => {
        const user = userEvent.setup();
        render(<TestHarness />);

        fireEvent.change(screen.getByLabelText(/dự kiến giờ về/i), { target: { value: '00:30' } });
        await user.type(screen.getByLabelText(/lý do/i), 'Night deployment');
        await user.click(screen.getByRole('button', { name: 'Tạo yêu cầu' }));

        await waitFor(() => {
            expect(screen.getByText('Xác nhận đăng ký OT')).toBeInTheDocument();
        });

        await user.click(screen.getByRole('button', { name: 'Xác nhận gửi' }));

        await waitFor(() => {
            expect(createRequest).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: 'OT_REQUEST',
                    date: '2099-03-02',
                    estimatedEndTime: '2099-03-03T00:30:00+07:00',
                })
            );
        });
    });
});
