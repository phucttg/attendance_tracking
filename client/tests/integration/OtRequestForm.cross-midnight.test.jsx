import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import OtRequestForm from '../../src/components/requests/OtRequestForm';
import { createRequest } from '../../src/api/requestApi';
import { getMyAttendance, getMyWorkSchedules } from '../../src/api/memberApi';

vi.mock('../../src/api/requestApi', () => ({
    createRequest: vi.fn(),
}));

vi.mock('../../src/api/memberApi', () => ({
    getMyWorkSchedules: vi.fn(),
    getMyAttendance: vi.fn(),
}));

const baseFormData = {
    date: '2099-03-02',
    estimatedEndTime: '',
    otStartTime: '',
    otMode: 'CONTINUOUS',
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
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2099-03-02T03:00:00.000Z')); // 10:00 GMT+7
        vi.clearAllMocks();

        createRequest.mockResolvedValue({ data: { request: { _id: 'ot-1' } } });
        getMyWorkSchedules.mockResolvedValue({
            data: {
                items: [
                    { workDate: '2099-03-02', scheduleType: 'SHIFT_1', isWorkday: true },
                    { workDate: '2099-03-03', scheduleType: 'SHIFT_1', isWorkday: true },
                ],
            },
        });
        getMyAttendance.mockResolvedValue({
            data: {
                items: [
                    {
                        date: '2099-03-01',
                        checkInAt: '2099-03-01T01:00:00.000Z',
                        checkOutAt: '2099-03-01T10:30:00.000Z',
                        scheduleType: 'SHIFT_1',
                    },
                ],
            },
        });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('shows next-day hint for continuous OT at 00:30 and 07:59, hides it at 08:00', async () => {
        render(<TestHarness />);
        await waitFor(() => expect(getMyWorkSchedules).toHaveBeenCalled());

        const timeInput = screen.getByLabelText(/giờ kết thúc ot/i);

        fireEvent.change(timeInput, { target: { value: '00:30' } });
        expect(screen.getByText(/Giờ kết thúc sẽ tính là ngày hôm sau/i)).toBeInTheDocument();

        fireEvent.change(timeInput, { target: { value: '07:59' } });
        expect(screen.getByText(/Giờ kết thúc sẽ tính là ngày hôm sau/i)).toBeInTheDocument();

        fireEvent.change(timeInput, { target: { value: '08:00' } });
        expect(screen.queryByText(/Giờ kết thúc sẽ tính là ngày hôm sau/i)).not.toBeInTheDocument();
    });

    it('calculates real-time OT duration correctly for continuous OT ending at 00:30', async () => {
        render(<TestHarness />);
        await waitFor(() => expect(getMyWorkSchedules).toHaveBeenCalled());

        fireEvent.change(screen.getByLabelText(/giờ kết thúc ot/i), { target: { value: '00:30' } });

        expect(screen.getByText(/Thời gian OT dự kiến:/i)).toBeInTheDocument();
        expect(screen.getByText('7 giờ 0 phút')).toBeInTheDocument();
    });

    it('submits continuous cross-midnight payload with next-day ISO timestamp', async () => {
        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
        render(<TestHarness />);
        await waitFor(() => expect(getMyWorkSchedules).toHaveBeenCalled());

        fireEvent.change(screen.getByLabelText(/giờ kết thúc ot/i), { target: { value: '00:30' } });
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

    it('submits separated carry-over payload on the selected actual OT date and shows anchor date in confirm modal', async () => {
        vi.setSystemTime(new Date('2099-03-01T18:45:00.000Z')); // 2099-03-02 01:45 GMT+7
        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
        render(
            <TestHarness
                initialData={{
                    ...baseFormData,
                    otMode: 'SEPARATED',
                }}
            />
        );
        await waitFor(() => expect(getMyAttendance).toHaveBeenCalled());

        fireEvent.change(screen.getByLabelText(/giờ bắt đầu ot/i), { target: { value: '01:30' } });
        fireEvent.change(screen.getByLabelText(/giờ kết thúc ot/i), { target: { value: '05:00' } });
        await user.type(screen.getByLabelText(/lý do/i), 'Emergency overnight support');
        await user.click(screen.getByRole('button', { name: 'Tạo yêu cầu' }));

        await waitFor(() => {
            expect(screen.getByText('Xác nhận đăng ký OT')).toBeInTheDocument();
        });

        expect(screen.getByText(/Ngày OT thực tế:/i)).toBeInTheDocument();
        expect(screen.getByText(/Ngày neo ca chính:/i)).toBeInTheDocument();
        expect(screen.getAllByText(/1\/3\/2099/).length).toBeGreaterThan(0);

        await user.click(screen.getByRole('button', { name: 'Xác nhận gửi' }));

        await waitFor(() => {
            expect(createRequest).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: 'OT_REQUEST',
                    date: '2099-03-02',
                    otMode: 'SEPARATED',
                    otStartTime: '2099-03-02T01:30:00+07:00',
                    estimatedEndTime: '2099-03-02T05:00:00+07:00',
                })
            );
        });
    });

    it('allows pre-registering tomorrow early-morning separated OT after today has checked out', async () => {
        vi.setSystemTime(new Date('2099-03-02T16:00:00.000Z')); // 2099-03-02 23:00 GMT+7
        getMyAttendance.mockResolvedValue({
            data: {
                items: [
                    {
                        date: '2099-03-02',
                        checkInAt: '2099-03-02T01:00:00.000Z',
                        checkOutAt: '2099-03-02T10:30:00.000Z',
                        scheduleType: 'SHIFT_1',
                    },
                ],
            },
        });

        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
        render(
            <TestHarness
                initialData={{
                    ...baseFormData,
                    date: '2099-03-03',
                    otMode: 'SEPARATED',
                }}
            />
        );
        await waitFor(() => expect(getMyAttendance).toHaveBeenCalled());

        fireEvent.change(screen.getByLabelText(/giờ bắt đầu ot/i), { target: { value: '01:30' } });
        fireEvent.change(screen.getByLabelText(/giờ kết thúc ot/i), { target: { value: '05:00' } });
        await user.type(screen.getByLabelText(/lý do/i), 'Planned overnight support');
        await user.click(screen.getByRole('button', { name: 'Tạo yêu cầu' }));

        await waitFor(() => {
            expect(screen.getByText('Xác nhận đăng ký OT')).toBeInTheDocument();
        });

        expect(screen.getByText(/Ngày OT thực tế:/i)).toBeInTheDocument();
        expect(screen.getByText(/Ngày neo ca chính:/i)).toBeInTheDocument();
        expect(screen.getAllByText(/3\/3\/2099/).length).toBeGreaterThan(0);
        expect(screen.getAllByText(/2\/3\/2099/).length).toBeGreaterThan(0);

        await user.click(screen.getByRole('button', { name: 'Xác nhận gửi' }));

        await waitFor(() => {
            expect(createRequest).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: 'OT_REQUEST',
                    date: '2099-03-03',
                    otMode: 'SEPARATED',
                    otStartTime: '2099-03-03T01:30:00+07:00',
                    estimatedEndTime: '2099-03-03T05:00:00+07:00',
                })
            );
        });
    });

    it('blocks pre-registering tomorrow early-morning separated OT before today has checked out', async () => {
        vi.setSystemTime(new Date('2099-03-02T08:00:00.000Z')); // 2099-03-02 15:00 GMT+7
        getMyAttendance.mockResolvedValue({
            data: {
                items: [
                    {
                        date: '2099-03-02',
                        checkInAt: '2099-03-02T01:00:00.000Z',
                        scheduleType: 'SHIFT_1',
                    },
                ],
            },
        });

        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
        render(
            <TestHarness
                initialData={{
                    ...baseFormData,
                    date: '2099-03-03',
                    otMode: 'SEPARATED',
                }}
            />
        );
        await waitFor(() => expect(getMyAttendance).toHaveBeenCalled());

        fireEvent.change(screen.getByLabelText(/giờ bắt đầu ot/i), { target: { value: '01:30' } });
        fireEvent.change(screen.getByLabelText(/giờ kết thúc ot/i), { target: { value: '05:00' } });
        await user.type(screen.getByLabelText(/lý do/i), 'Should be blocked before checkout');
        await user.click(screen.getByRole('button', { name: 'Tạo yêu cầu' }));

        await waitFor(() => {
            expect(screen.getByTestId('form-error')).toHaveTextContent(
                'Chưa thể đăng ký trước OT rạng sáng ngày mai vì ca hôm nay chưa check-out'
            );
        });
        expect(createRequest).not.toHaveBeenCalled();
    });

    it('submits flexible continuous OT for a past day in the current month with explicit otStartTime', async () => {
        vi.setSystemTime(new Date('2099-03-15T03:00:00.000Z')); // 10:00 GMT+7
        getMyAttendance.mockResolvedValue({
            data: {
                items: [
                    {
                        date: '2099-03-10',
                        checkInAt: '2099-03-10T01:30:00.000Z',
                        checkOutAt: '2099-03-10T12:30:00.000Z',
                        scheduleType: 'FLEXIBLE',
                    },
                ],
            },
        });

        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
        render(
            <TestHarness
                initialData={{
                    ...baseFormData,
                    date: '2099-03-10',
                }}
            />
        );
        await waitFor(() => expect(getMyAttendance).toHaveBeenCalled());

        fireEvent.change(screen.getByLabelText(/giờ bắt đầu ot linh hoạt/i), { target: { value: '18:00' } });
        fireEvent.change(screen.getByLabelText(/giờ kết thúc ot/i), { target: { value: '22:00' } });
        await user.type(screen.getByLabelText(/lý do/i), 'Flexible past-day OT');
        await user.click(screen.getByRole('button', { name: 'Tạo yêu cầu' }));

        await waitFor(() => {
            expect(screen.getByText('Xác nhận đăng ký OT')).toBeInTheDocument();
        });

        await user.click(screen.getByRole('button', { name: 'Xác nhận gửi' }));

        await waitFor(() => {
            expect(createRequest).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: 'OT_REQUEST',
                    date: '2099-03-10',
                    otMode: 'CONTINUOUS',
                    otStartTime: '2099-03-10T18:00:00+07:00',
                    estimatedEndTime: '2099-03-10T22:00:00+07:00',
                })
            );
        });
    });

    it('uses actual checkout as a read-only end time for fixed-shift continuous OT on a past day in the current month', async () => {
        vi.setSystemTime(new Date('2099-03-15T03:00:00.000Z')); // 10:00 GMT+7
        getMyAttendance.mockResolvedValue({
            data: {
                items: [
                    {
                        date: '2099-03-10',
                        checkInAt: '2099-03-10T01:00:00.000Z',
                        checkOutAt: '2099-03-10T13:30:00.000Z',
                        scheduleType: 'SHIFT_1',
                    },
                ],
            },
        });

        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
        render(
            <TestHarness
                initialData={{
                    ...baseFormData,
                    date: '2099-03-10',
                }}
            />
        );
        await waitFor(() => expect(getMyAttendance).toHaveBeenCalled());

        const endInput = screen.getByLabelText(/giờ kết thúc ot/i);
        expect(endInput).toHaveValue('20:30');
        expect(endInput.readOnly).toBe(true);

        await user.type(screen.getByLabelText(/lý do/i), 'Past fixed continuous OT');
        await user.click(screen.getByRole('button', { name: 'Tạo yêu cầu' }));

        await waitFor(() => {
            expect(screen.getByText('Xác nhận đăng ký OT')).toBeInTheDocument();
        });

        await user.click(screen.getByRole('button', { name: 'Xác nhận gửi' }));

        await waitFor(() => {
            expect(createRequest).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: 'OT_REQUEST',
                    date: '2099-03-10',
                    otMode: 'CONTINUOUS',
                    estimatedEndTime: '2099-03-10T20:30:00+07:00',
                })
            );
        });
    });

    it('submits fixed-shift separated OT for a past day in the current month when attendance is complete', async () => {
        vi.setSystemTime(new Date('2099-03-15T03:00:00.000Z')); // 10:00 GMT+7
        getMyAttendance.mockResolvedValue({
            data: {
                items: [
                    {
                        date: '2099-03-10',
                        checkInAt: '2099-03-10T01:00:00.000Z',
                        checkOutAt: '2099-03-10T11:10:00.000Z',
                        scheduleType: 'SHIFT_1',
                    },
                ],
            },
        });

        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
        render(
            <TestHarness
                initialData={{
                    ...baseFormData,
                    date: '2099-03-10',
                    otMode: 'SEPARATED',
                }}
            />
        );
        await waitFor(() => expect(getMyAttendance).toHaveBeenCalled());

        fireEvent.change(screen.getByLabelText(/giờ bắt đầu ot/i), { target: { value: '19:00' } });
        fireEvent.change(screen.getByLabelText(/giờ kết thúc ot/i), { target: { value: '22:00' } });
        await user.type(screen.getByLabelText(/lý do/i), 'Past fixed separated OT');
        await user.click(screen.getByRole('button', { name: 'Tạo yêu cầu' }));

        await waitFor(() => {
            expect(screen.getByText('Xác nhận đăng ký OT')).toBeInTheDocument();
        });

        await user.click(screen.getByRole('button', { name: 'Xác nhận gửi' }));

        await waitFor(() => {
            expect(createRequest).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: 'OT_REQUEST',
                    date: '2099-03-10',
                    otMode: 'SEPARATED',
                    otStartTime: '2099-03-10T19:00:00+07:00',
                    estimatedEndTime: '2099-03-10T22:00:00+07:00',
                })
            );
        });
    });

    it('blocks flexible separated OT for a past day when attendance is incomplete', async () => {
        vi.setSystemTime(new Date('2099-03-15T03:00:00.000Z')); // 10:00 GMT+7
        getMyAttendance.mockResolvedValue({
            data: {
                items: [
                    {
                        date: '2099-03-10',
                        checkInAt: '2099-03-10T01:30:00.000Z',
                        scheduleType: 'FLEXIBLE',
                    },
                ],
            },
        });

        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
        render(
            <TestHarness
                initialData={{
                    ...baseFormData,
                    date: '2099-03-10',
                    otMode: 'SEPARATED',
                }}
            />
        );
        await waitFor(() => expect(getMyAttendance).toHaveBeenCalled());

        fireEvent.change(screen.getByLabelText(/giờ bắt đầu ot/i), { target: { value: '19:00' } });
        fireEvent.change(screen.getByLabelText(/giờ kết thúc ot/i), { target: { value: '21:00' } });
        await user.type(screen.getByLabelText(/lý do/i), 'Should fail without checkout');
        await user.click(screen.getByRole('button', { name: 'Tạo yêu cầu' }));

        await waitFor(() => {
            expect(screen.getByTestId('form-error')).toHaveTextContent(
                'attendance đã hoàn tất'
            );
        });
        expect(createRequest).not.toHaveBeenCalled();
    });
});
