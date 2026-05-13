import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MySchedulePage from '../../src/pages/MySchedulePage';
import * as memberApi from '../../src/api/memberApi';

vi.mock('../../src/api/memberApi', () => ({
    getMyWorkSchedules: vi.fn(),
    putMyWorkSchedules: vi.fn()
}));

const baseDates = [
    '2099-03-02',
    '2099-03-03',
    '2099-03-04',
    '2099-03-05',
    '2099-03-06',
    '2099-03-07',
    '2099-03-08',
];

const makeItem = (workDate, overrides = {}) => ({
    workDate,
    scheduleType: null,
    isWorkday: true,
    isWeekend: false,
    isHoliday: false,
    isReadOnly: false,
    isLocked: false,
    isSuppressedByCalendar: false,
    lockedReason: null,
    ...overrides,
});

const makeWindow = (items) => ({
    windowStart: baseDates[0],
    windowEnd: baseDates[baseDates.length - 1],
    days: baseDates.length,
    items,
});

const renderWithSchedule = async (items) => {
    memberApi.getMyWorkSchedules.mockResolvedValueOnce({
        data: makeWindow(items)
    });

    render(<MySchedulePage />);

    await waitFor(() => {
        expect(memberApi.getMyWorkSchedules).toHaveBeenCalled();
    });
    await waitFor(() => {
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
};

describe('MySchedulePage flexible editing', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('keeps a saved schedule editable when isReadOnly is false', async () => {
        await renderWithSchedule([
            makeItem(baseDates[0], { scheduleType: 'SHIFT_1', isReadOnly: false, isLocked: false }),
        ]);

        const select = screen.getByRole('combobox');
        expect(select).toBeEnabled();
        expect(select).toHaveValue('SHIFT_1');
        expect(screen.getByText('Có thể sửa')).toBeInTheDocument();
    });

    it('disables readonly rows and shows their locked reason', async () => {
        await renderWithSchedule([
            makeItem(baseDates[0], {
                scheduleType: 'SHIFT_1',
                isReadOnly: true,
                isLocked: true,
                lockedReason: 'ALREADY_CHECKED_IN'
            }),
        ]);

        expect(screen.getByRole('combobox')).toBeDisabled();
        expect(screen.getByText('Đã check-in')).toBeInTheDocument();
    });

    it('quick apply updates only editable draft rows', async () => {
        const user = userEvent.setup();

        await renderWithSchedule([
            makeItem(baseDates[0], { scheduleType: 'SHIFT_1' }),
            makeItem(baseDates[1], { scheduleType: 'SHIFT_1', isReadOnly: true, isLocked: true, lockedReason: 'OT_LOCKED' }),
            makeItem(baseDates[2], { scheduleType: null }),
        ]);

        await user.click(screen.getByRole('button', { name: 'Áp dụng Ca 2' }));

        const selects = screen.getAllByRole('combobox');
        expect(selects[0]).toHaveValue('SHIFT_2');
        expect(selects[1]).toHaveValue('SHIFT_1');
        expect(selects[1]).toBeDisabled();
        expect(selects[2]).toHaveValue('SHIFT_2');
    });

    it('saves a full 7-day payload and shows the new success message', async () => {
        const user = userEvent.setup();
        const items = baseDates.map((workDate, index) => makeItem(workDate, {
            scheduleType: index === 1 ? 'SHIFT_1' : null,
            isReadOnly: index === 5,
            isLocked: index === 5,
            lockedReason: index === 5 ? 'NON_WORKDAY' : null,
            isWorkday: index !== 5,
            isWeekend: index === 5
        }));
        const savedItems = items.map((item, index) => ({
            ...item,
            scheduleType: index === 5 ? item.scheduleType : 'FLEXIBLE'
        }));

        await renderWithSchedule(items);
        memberApi.putMyWorkSchedules.mockResolvedValueOnce({
            data: makeWindow(savedItems)
        });

        await user.click(screen.getByRole('button', { name: 'Áp dụng Linh hoạt' }));
        await user.click(screen.getByRole('button', { name: 'Lưu lịch' }));

        await waitFor(() => {
            expect(memberApi.putMyWorkSchedules).toHaveBeenCalledTimes(1);
        });

        expect(memberApi.putMyWorkSchedules).toHaveBeenCalledWith(
            baseDates.map((workDate, index) => ({
                workDate,
                scheduleType: index === 5 ? null : 'FLEXIBLE'
            }))
        );
        expect(await screen.findByText('Đã lưu lịch ca')).toBeInTheDocument();
    });
});
