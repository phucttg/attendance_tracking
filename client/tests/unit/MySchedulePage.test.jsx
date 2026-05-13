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
        expect(memberApi.getMyWorkSchedules).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });
};

describe('MySchedulePage unit behavior', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('keeps saved schedule rows editable when isReadOnly is false', async () => {
        await renderWithSchedule([
            makeItem(baseDates[0], { scheduleType: 'SHIFT_1', isReadOnly: false }),
        ]);

        const select = screen.getByRole('combobox');
        expect(select).toBeEnabled();
        expect(select).toHaveValue('SHIFT_1');
        expect(screen.getByText('Có thể sửa')).toBeInTheDocument();
    });

    it('disables rows from isReadOnly and ignores stale isLocked when isReadOnly is false', async () => {
        await renderWithSchedule([
            makeItem(baseDates[0], {
                scheduleType: 'SHIFT_1',
                isReadOnly: true,
                isLocked: false,
                lockedReason: 'ALREADY_CHECKED_IN'
            }),
            makeItem(baseDates[1], {
                scheduleType: 'SHIFT_2',
                isReadOnly: false,
                isLocked: true,
                lockedReason: null
            }),
        ]);

        const selects = screen.getAllByRole('combobox');
        expect(selects[0]).toBeDisabled();
        expect(selects[1]).toBeEnabled();
    });

    it.each([
        ['ALREADY_CHECKED_IN', 'Đã check-in'],
        ['NON_WORKDAY', 'Cuối tuần / ngày lễ'],
        ['OT_LOCKED', 'Đã có OT đang chờ/đã duyệt'],
        ['PAST_DATE', 'Ngày quá khứ'],
    ])('shows Vietnamese readonly label for %s', async (lockedReason, expectedLabel) => {
        await renderWithSchedule([
            makeItem(baseDates[0], {
                scheduleType: 'SHIFT_1',
                isReadOnly: true,
                lockedReason
            }),
        ]);

        expect(screen.getByText(expectedLabel)).toBeInTheDocument();
    });

    it('shows save errors by date before the normal readonly label', async () => {
        const user = userEvent.setup();

        await renderWithSchedule([
            makeItem(baseDates[0], { scheduleType: 'SHIFT_1' }),
            makeItem(baseDates[1], {
                scheduleType: 'SHIFT_2',
                isReadOnly: true,
                lockedReason: 'ALREADY_CHECKED_IN'
            }),
        ]);

        memberApi.putMyWorkSchedules.mockRejectedValueOnce({
            response: {
                data: {
                    code: 'INVALID_SCHEDULE_WINDOW',
                    message: 'Invalid schedule update',
                    errorsByDate: {
                        [baseDates[1]]: 'OT_LOCKED'
                    }
                }
            }
        });

        await user.selectOptions(screen.getAllByRole('combobox')[0], 'FLEXIBLE');
        await user.click(screen.getByRole('button', { name: 'Lưu lịch' }));

        expect(await screen.findByText('Lỗi: Đã có OT đang chờ/đã duyệt')).toBeInTheDocument();
        expect(screen.getByRole('alert')).toHaveTextContent('Invalid schedule update');
    });

    it('quick apply Ca 1 updates only editable draft rows', async () => {
        const user = userEvent.setup();

        await renderWithSchedule([
            makeItem(baseDates[0], { scheduleType: null }),
            makeItem(baseDates[1], { scheduleType: 'SHIFT_2', isReadOnly: true }),
            makeItem(baseDates[2], { scheduleType: 'FLEXIBLE' }),
        ]);

        await user.click(screen.getByRole('button', { name: 'Áp dụng Ca 1' }));

        const selects = screen.getAllByRole('combobox');
        expect(selects[0]).toHaveValue('SHIFT_1');
        expect(selects[1]).toHaveValue('SHIFT_2');
        expect(selects[2]).toHaveValue('SHIFT_1');
    });

    it('quick apply Ca 2 keeps readonly draft rows unchanged', async () => {
        const user = userEvent.setup();

        await renderWithSchedule([
            makeItem(baseDates[0], { scheduleType: 'SHIFT_1' }),
            makeItem(baseDates[1], { scheduleType: 'FLEXIBLE', isReadOnly: true }),
            makeItem(baseDates[2], { scheduleType: null }),
        ]);

        await user.click(screen.getByRole('button', { name: 'Áp dụng Ca 2' }));

        const selects = screen.getAllByRole('combobox');
        expect(selects[0]).toHaveValue('SHIFT_2');
        expect(selects[1]).toHaveValue('FLEXIBLE');
        expect(selects[2]).toHaveValue('SHIFT_2');
    });

    it('quick apply Linh hoạt updates only editable rows', async () => {
        const user = userEvent.setup();

        await renderWithSchedule([
            makeItem(baseDates[0], { scheduleType: 'SHIFT_1' }),
            makeItem(baseDates[1], { scheduleType: 'SHIFT_2', isReadOnly: true }),
            makeItem(baseDates[2], { scheduleType: null }),
        ]);

        await user.click(screen.getByRole('button', { name: 'Áp dụng Linh hoạt' }));

        const selects = screen.getAllByRole('combobox');
        expect(selects[0]).toHaveValue('FLEXIBLE');
        expect(selects[1]).toHaveValue('SHIFT_2');
        expect(selects[2]).toHaveValue('FLEXIBLE');
    });

    it('saves the full 7-day payload from the current draft', async () => {
        const user = userEvent.setup();
        const items = baseDates.map((workDate, index) => makeItem(workDate, {
            scheduleType: index === 1 ? 'SHIFT_1' : null,
            isReadOnly: index === 5,
            lockedReason: index === 5 ? 'NON_WORKDAY' : null,
            isWorkday: index !== 5,
            isWeekend: index === 5
        }));

        await renderWithSchedule(items);
        memberApi.putMyWorkSchedules.mockResolvedValueOnce({
            data: makeWindow(items)
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
    });

    it('shows save success and refreshes draft from the response', async () => {
        const user = userEvent.setup();
        const initialItems = [
            makeItem(baseDates[0], { scheduleType: 'SHIFT_1' }),
        ];
        const savedItems = [
            makeItem(baseDates[0], { scheduleType: 'SHIFT_2' }),
        ];

        await renderWithSchedule(initialItems);
        memberApi.putMyWorkSchedules.mockResolvedValueOnce({
            data: makeWindow(savedItems)
        });

        await user.selectOptions(screen.getByRole('combobox'), 'FLEXIBLE');
        await user.click(screen.getByRole('button', { name: 'Lưu lịch' }));

        expect(await screen.findByText('Đã lưu lịch ca')).toBeInTheDocument();
        expect(screen.getByRole('combobox')).toHaveValue('SHIFT_2');
    });

    it('does not render old locked-schedule wording', async () => {
        await renderWithSchedule([
            makeItem(baseDates[0], { scheduleType: null }),
        ]);

        expect(screen.getByText('Lưu lịch')).toBeInTheDocument();
        expect(screen.getByText('Chưa chọn')).toBeInTheDocument();
        expect(screen.queryByText('Chốt lịch')).not.toBeInTheDocument();
        expect(screen.queryByText('Chưa chốt')).not.toBeInTheDocument();
        expect(screen.queryByText(/Đã chốt ca/)).not.toBeInTheDocument();
    });

    it('disables quick apply buttons when no rows are editable', async () => {
        await renderWithSchedule([
            makeItem(baseDates[0], { isReadOnly: true, lockedReason: 'ALREADY_CHECKED_IN' }),
            makeItem(baseDates[1], { isReadOnly: true, lockedReason: 'OT_LOCKED' }),
        ]);

        expect(screen.getByRole('button', { name: 'Áp dụng Ca 1' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Áp dụng Ca 2' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Áp dụng Linh hoạt' })).toBeDisabled();
    });

    it('disables selects and action buttons while saving', async () => {
        const user = userEvent.setup();
        await renderWithSchedule([
            makeItem(baseDates[0], { scheduleType: 'SHIFT_1' }),
        ]);

        memberApi.putMyWorkSchedules.mockImplementationOnce(() => new Promise(() => {}));
        await user.click(screen.getByRole('button', { name: 'Lưu lịch' }));

        expect(await screen.findByText('Đang lưu...')).toBeInTheDocument();
        expect(screen.getByRole('combobox')).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Áp dụng Ca 1' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Áp dụng Ca 2' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Áp dụng Linh hoạt' })).toBeDisabled();
    });
});
