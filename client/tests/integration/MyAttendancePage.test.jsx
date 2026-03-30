/**
 * MyAttendancePage Integration Tests
 * 
 * Test Design: Boundary Value Analysis + State Transition (ISTQB)
 * Test Type: Integration
 * Priority: MEDIUM
 * ISO 25010: Functional Suitability, Usability
 * 
 * Coverage:
 * - Month selector functionality
 * - Table rendering with attendance data
 * - Status badges based on date comparison
 * - Loading and empty states
 * - Timezone handling (GMT+7)
 * 
 * ROBUSTNESS:
 * - Uses vi.useFakeTimers({ shouldAdvanceTime: true }) to freeze date
 *   while allowing async operations to work
 * - All date comparisons are deterministic
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import MyAttendancePage from '../../src/pages/MyAttendancePage';
import client from '../../src/api/client';

// Mock API client
vi.mock('../../src/api/client');

// Mock useAuth (not directly used but may be needed by Layout)
vi.mock('../../src/context/AuthContext', () => ({
    useAuth: vi.fn(() => ({
        user: { _id: '1', name: 'Employee', role: 'EMPLOYEE' },
        token: 'test-token',
        loading: false,
    })),
}));

describe('MyAttendancePage - Integration Tests', () => {
    // =====================================================
    // FROZEN DATE SETUP
    // =====================================================
    // We set "today" to 2026-01-15 for deterministic date comparisons
    // Using shouldAdvanceTime: true allows async operations to work

    const FROZEN_DATE = new Date('2026-01-15T10:00:00+07:00');
    const frozenToday = '2026-01-15';
    const frozenMonth = '2026-01';

    beforeEach(() => {
        vi.clearAllMocks();

        // Use fake timers with auto-advance to allow async to work
        vi.useFakeTimers({ shouldAdvanceTime: true });
        vi.setSystemTime(FROZEN_DATE);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('1. Page Rendering', () => {
        it('[ATT-01] Shows loading spinner while fetching', async () => {
            client.get.mockImplementation(() => new Promise(() => { }));

            render(
                <MemoryRouter>
                    <MyAttendancePage />
                </MemoryRouter>
            );

            expect(screen.getByRole('status')).toBeInTheDocument();
        });

        it('[ATT-02] Renders page title and month selector', async () => {
            client.get.mockResolvedValue({ data: { items: [] } });

            render(
                <MemoryRouter>
                    <MyAttendancePage />
                </MemoryRouter>
            );

            await waitFor(() => {
                expect(screen.queryByRole('status')).not.toBeInTheDocument();
            });

            // Page title (Vietnamese)
            expect(screen.getByText(/lịch sử chấm công/i)).toBeInTheDocument();

            // Month selector exists
            expect(screen.getByRole('combobox')).toBeInTheDocument();
        });

        it('[ATT-03] Renders attendance table with data', async () => {
            client.get.mockResolvedValue({
                data: {
                    items: [
                        {
                            date: '2026-01-10',
                            checkInAt: '2026-01-10T08:30:00+07:00',
                            checkOutAt: '2026-01-10T17:30:00+07:00',
                            status: 'ON_TIME',
                            lateMinutes: 0,
                            workMinutes: 480,
                            otMinutes: 0,
                        },
                        {
                            date: '2026-01-11',
                            checkInAt: '2026-01-11T09:00:00+07:00',
                            checkOutAt: '2026-01-11T17:30:00+07:00',
                            status: 'LATE',
                            lateMinutes: 15,
                            workMinutes: 465,
                            otMinutes: 0,
                        },
                    ]
                }
            });

            render(
                <MemoryRouter>
                    <MyAttendancePage />
                </MemoryRouter>
            );

            await waitFor(() => {
                expect(screen.getByText(/đúng giờ/i)).toBeInTheDocument();
            });

            // Table headers (Vietnamese)
            expect(screen.getByText('Ngày')).toBeInTheDocument();
            expect(screen.getByText('Check-in')).toBeInTheDocument();
            expect(screen.getByText('Check-out')).toBeInTheDocument();
            expect(screen.getByText('Trạng thái')).toBeInTheDocument();

            // Data rows - times may appear multiple times
            expect(screen.getAllByText('08:30').length).toBeGreaterThan(0);
            expect(screen.getAllByText('17:30').length).toBeGreaterThan(0);

            // Late minutes displayed
            expect(screen.getByText('15 phút')).toBeInTheDocument();
        });
    });

    describe('2. Month Selector', () => {
        it('[ATT-04] Changing month fetches new data', async () => {
            const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

            client.get.mockResolvedValue({ data: { items: [] } });

            render(
                <MemoryRouter>
                    <MyAttendancePage />
                </MemoryRouter>
            );

            await waitFor(() => {
                expect(screen.queryByRole('status')).not.toBeInTheDocument();
            });

            // Clear initial call count
            client.get.mockClear();
            client.get.mockResolvedValue({ data: { items: [] } });

            // Get month selector
            const selector = screen.getByRole('combobox');

            // Change selection to previous month
            await user.selectOptions(selector, selector.options[1].value);

            // After month change: 1 attendance call + 1 OT-request call
            await waitFor(() => {
                expect(client.get).toHaveBeenCalledTimes(2);
            });

            // Should call attendance with different month (2025-12)
            const prevMonth = selector.options[1].value;
            expect(client.get).toHaveBeenCalledWith(
                `/attendance/me?month=${prevMonth}`,
                expect.anything()
            );
        });

        it('[ATT-05] Month selector has 12 months options', async () => {
            client.get.mockResolvedValue({ data: { items: [] } });

            render(
                <MemoryRouter>
                    <MyAttendancePage />
                </MemoryRouter>
            );

            await waitFor(() => {
                expect(screen.queryByRole('status')).not.toBeInTheDocument();
            });

            const selector = screen.getByRole('combobox');
            expect(selector.options.length).toBe(12);
        });

        it('[ATT-06] Default month is current month (frozen: 2026-01)', async () => {
            client.get.mockResolvedValue({ data: { items: [] } });

            render(
                <MemoryRouter>
                    <MyAttendancePage />
                </MemoryRouter>
            );

            await waitFor(() => {
                expect(screen.queryByRole('status')).not.toBeInTheDocument();
            });

            const selector = screen.getByRole('combobox');
            expect(selector.value).toBe(frozenMonth);
        });
    });

    describe('3. Status Badges', () => {
        it('[ATT-07] Different statuses show correct Vietnamese labels', async () => {
            client.get.mockResolvedValue({
                data: {
                    items: [
                        { date: '2026-01-05', status: 'ON_TIME', checkInAt: '2026-01-05T08:30:00+07:00' },
                        { date: '2026-01-06', status: 'LATE', checkInAt: '2026-01-06T09:00:00+07:00' },
                        { date: '2026-01-07', status: 'MISSING_CHECKOUT', checkInAt: '2026-01-07T08:30:00+07:00' },
                        { date: '2026-01-08', status: 'ABSENT' },
                        { date: '2026-01-09', status: 'WEEKEND_OR_HOLIDAY' },
                    ]
                }
            });

            render(
                <MemoryRouter>
                    <MyAttendancePage />
                </MemoryRouter>
            );

            await waitFor(() => {
                // Multiple statuses displayed
                expect(screen.getAllByText(/đúng giờ/i).length).toBeGreaterThan(0);
                expect(screen.getAllByText(/đi muộn/i).length).toBeGreaterThan(0);
                expect(screen.getAllByText(/thiếu checkout/i).length).toBeGreaterThan(0);
                expect(screen.getAllByText(/vắng mặt/i).length).toBeGreaterThan(0);
                expect(screen.getAllByText(/nghỉ/i).length).toBeGreaterThan(0);
            });
        });

        it('[ATT-08] Null status with future date shows "Chưa tới"', async () => {
            // FROZEN: today = 2026-01-15
            // futureDate = 2026-01-20 (5 days in future)
            const futureDate = '2026-01-20';

            client.get.mockResolvedValue({
                data: {
                    items: [
                        { date: futureDate, status: null },
                    ]
                }
            });

            render(
                <MemoryRouter>
                    <MyAttendancePage />
                </MemoryRouter>
            );

            await waitFor(() => {
                expect(screen.getByText(/chưa tới/i)).toBeInTheDocument();
            });
        });

        it('[ATT-08b] Null status with today shows "Chưa check-in"', async () => {
            // FROZEN: today = 2026-01-15
            client.get.mockResolvedValue({
                data: {
                    items: [
                        { date: frozenToday, status: null },
                    ]
                }
            });

            render(
                <MemoryRouter>
                    <MyAttendancePage />
                </MemoryRouter>
            );

            await waitFor(() => {
                expect(screen.getByText(/chưa check-in/i)).toBeInTheDocument();
            });
        });

        it('[ATT-08c] Null status with past date shows "Vắng mặt"', async () => {
            // FROZEN: today = 2026-01-15
            // pastDate = 2026-01-10 (5 days ago)
            const pastDate = '2026-01-10';

            client.get.mockResolvedValue({
                data: {
                    items: [
                        { date: pastDate, status: null },
                    ]
                }
            });

            render(
                <MemoryRouter>
                    <MyAttendancePage />
                </MemoryRouter>
            );

            await waitFor(() => {
                expect(screen.getByText(/vắng mặt/i)).toBeInTheDocument();
            });
        });
    });

    describe('4. Empty State', () => {
        it('[ATT-09] No data shows empty message', async () => {
            client.get.mockResolvedValue({ data: { items: [] } });

            render(
                <MemoryRouter>
                    <MyAttendancePage />
                </MemoryRouter>
            );

            await waitFor(() => {
                expect(screen.getByText(/không có dữ liệu chấm công/i)).toBeInTheDocument();
            });
        });
    });

    describe('5. Error Handling', () => {
        it('[ATT-10] API error shows error alert', async () => {
            client.get.mockRejectedValue({
                response: { data: { message: 'Failed to load' } }
            });

            render(
                <MemoryRouter>
                    <MyAttendancePage />
                </MemoryRouter>
            );

            const alert = await screen.findByRole('alert');
            expect(alert).toHaveTextContent('Failed to load');
        });

        it('[ATT-11] Error alert can be dismissed', async () => {
            const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

            client.get.mockRejectedValue({
                response: { data: { message: 'Error' } }
            });

            render(
                <MemoryRouter>
                    <MyAttendancePage />
                </MemoryRouter>
            );

            await screen.findByRole('alert');

            const dismissButton = screen.getByRole('button', { name: /dismiss/i });
            await user.click(dismissButton);

            await waitFor(() => {
                expect(screen.queryByRole('alert')).not.toBeInTheDocument();
            });
        });
    });

    // =====================================================================
    // 7. OT Request Status Badges
    // Plan step 5.6: show OT request status badge per day.
    // =====================================================================
    describe('7. OT Request Status Badges', () => {
        /**
         * Helper: build standard client.get mock that returns different
         * responses for attendance vs. OT requests endpoints.
         */
        const mockBothEndpoints = ({ attendanceItems = [], otItems = [], otTotalPages = 1 } = {}) => {
            client.get.mockImplementation((url) => {
                if (url.startsWith('/attendance/me')) {
                    return Promise.resolve({ data: { items: attendanceItems } });
                }
                // /requests/me — OT requests endpoint
                return Promise.resolve({
                    data: {
                        items: otItems,
                        pagination: { page: 1, limit: 100, total: otItems.length, totalPages: otTotalPages },
                    },
                });
            });
        };

        it('[ATT-OT-01] OT request with otMinutes=0 shows status badge only', async () => {
            mockBothEndpoints({
                attendanceItems: [
                    {
                        date: '2026-01-10',
                        checkInAt: '2026-01-10T08:30:00+07:00',
                        checkOutAt: '2026-01-10T17:30:00+07:00',
                        status: 'ON_TIME',
                        lateMinutes: 0,
                        workMinutes: 480,
                        otMinutes: 0,
                    },
                ],
                otItems: [
                    { type: 'OT_REQUEST', date: '2026-01-10', status: 'PENDING' },
                ],
            });

            render(
                <MemoryRouter>
                    <MyAttendancePage />
                </MemoryRouter>
            );

            // Badge should appear even though otMinutes is 0
            await waitFor(() => {
                expect(screen.getByText('Chờ duyệt')).toBeInTheDocument();
            });

            // OT column must not render an OT-minutes span (otMinutes=0)
            // workMinutes would show '480 phút' in a separate column, so
            // ensure the OT badge element is rendered instead of minutes
            expect(screen.queryByTestId('ot-request-badge')).toBeInTheDocument();
        });

        it('[ATT-OT-02] otMinutes>0 AND OT request exists shows both minutes and badge', async () => {
            mockBothEndpoints({
                attendanceItems: [
                    {
                        date: '2026-01-10',
                        checkInAt: '2026-01-10T08:30:00+07:00',
                        checkOutAt: '2026-01-10T20:00:00+07:00',
                        status: 'ON_TIME',
                        lateMinutes: 0,
                        workMinutes: 480,
                        otMinutes: 120,
                    },
                ],
                otItems: [
                    { type: 'OT_REQUEST', date: '2026-01-10', status: 'APPROVED' },
                ],
            });

            render(
                <MemoryRouter>
                    <MyAttendancePage />
                </MemoryRouter>
            );

            await waitFor(() => {
                expect(screen.getByText('120 phút')).toBeInTheDocument();
                expect(screen.getByText('Đã duyệt')).toBeInTheDocument();
            });
        });

        it('[ATT-OT-03] No OT request and otMinutes=0 shows dash', async () => {
            mockBothEndpoints({
                attendanceItems: [
                    {
                        date: '2026-01-10',
                        checkInAt: '2026-01-10T08:30:00+07:00',
                        checkOutAt: '2026-01-10T17:30:00+07:00',
                        status: 'ON_TIME',
                        lateMinutes: 0,
                        workMinutes: 480,
                        otMinutes: 0,
                    },
                ],
                otItems: [],
            });

            render(
                <MemoryRouter>
                    <MyAttendancePage />
                </MemoryRouter>
            );

            await waitFor(() => {
                expect(screen.queryByRole('status')).not.toBeInTheDocument();
            });

            // OT column should show dash: no badge, no OT-specific minutes text
            expect(screen.queryByTestId('ot-request-badge')).not.toBeInTheDocument();
            // workMinutes shows '480 phút' in work column; OT column specifically must not yield a green span
            expect(screen.queryByText('0 phút')).not.toBeInTheDocument();
        });

        it('[ATT-OT-04] Multiple OT requests same date across pages: newest (first page) wins', async () => {
            // Page 1 (most recent): APPROVED; Page 2 (older): PENDING for same date
            let callCount = 0;
            client.get.mockImplementation((url) => {
                if (url.startsWith('/attendance/me')) {
                    return Promise.resolve({
                        data: {
                            items: [
                                {
                                    date: '2026-01-10',
                                    checkInAt: null,
                                    checkOutAt: null,
                                    status: 'ON_TIME',
                                    lateMinutes: 0,
                                    workMinutes: 0,
                                    otMinutes: 0,
                                },
                            ],
                        },
                    });
                }
                callCount++;
                if (callCount === 1) {
                    return Promise.resolve({
                        data: {
                            items: [{ type: 'OT_REQUEST', date: '2026-01-10', status: 'APPROVED' }],
                            pagination: { page: 1, limit: 100, total: 2, totalPages: 2 },
                        },
                    });
                }
                return Promise.resolve({
                    data: {
                        items: [{ type: 'OT_REQUEST', date: '2026-01-10', status: 'PENDING' }],
                        pagination: { page: 2, limit: 100, total: 2, totalPages: 2 },
                    },
                });
            });

            render(
                <MemoryRouter>
                    <MyAttendancePage />
                </MemoryRouter>
            );

            // Should show APPROVED (first-seen = newest) not PENDING (second page = older)
            await waitFor(() => {
                expect(screen.getByText('Đã duyệt')).toBeInTheDocument();
            });
            expect(screen.queryByText('Chờ duyệt')).not.toBeInTheDocument();
        });

        it('[ATT-OT-05] OT request endpoint fails: attendance table still renders without crash', async () => {
            client.get.mockImplementation((url) => {
                if (url.startsWith('/attendance/me')) {
                    return Promise.resolve({
                        data: {
                            items: [
                                {
                                    date: '2026-01-10',
                                    checkInAt: '2026-01-10T08:30:00+07:00',
                                    checkOutAt: '2026-01-10T17:30:00+07:00',
                                    status: 'ON_TIME',
                                    lateMinutes: 0,
                                    workMinutes: 480,
                                    otMinutes: 0,
                                },
                            ],
                        },
                    });
                }
                return Promise.reject(new Error('Network Error'));
            });

            render(
                <MemoryRouter>
                    <MyAttendancePage />
                </MemoryRouter>
            );

            // Attendance table renders successfully
            await waitFor(() => {
                expect(screen.getByText(/đúng giờ/i)).toBeInTheDocument();
            });

            // No OT badge (fetch failed) and no crash
            expect(screen.queryByTestId('ot-request-badge')).not.toBeInTheDocument();
            // Main error alert must NOT appear (OT failure is non-blocking)
            expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        });

        it('[ATT-OT-06] Changing selectedMonth clears old badges and loads new ones', async () => {
            const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

            // Initial month (2026-01): OT request for jan
            // After month change (2025-12): no OT requests
            client.get.mockImplementation((url) => {
                if (url.startsWith('/attendance/me')) {
                    return Promise.resolve({ data: { items: [] } });
                }
                return Promise.resolve({
                    data: {
                        items: [{ type: 'OT_REQUEST', date: '2026-01-10', status: 'PENDING' }],
                        pagination: { page: 1, limit: 100, total: 1, totalPages: 1 },
                    },
                });
            });

            render(
                <MemoryRouter>
                    <MyAttendancePage />
                </MemoryRouter>
            );

            await waitFor(() => {
                expect(screen.queryByRole('status')).not.toBeInTheDocument();
            });

            // Switch to previous month — OT requests for 2025-12 are empty
            client.get.mockImplementation((url) => {
                if (url.startsWith('/attendance/me')) {
                    return Promise.resolve({ data: { items: [] } });
                }
                return Promise.resolve({
                    data: {
                        items: [],
                        pagination: { page: 1, limit: 100, total: 0, totalPages: 1 },
                    },
                });
            });

            const selector = screen.getByRole('combobox');
            await user.selectOptions(selector, selector.options[1].value);

            await waitFor(() => {
                expect(screen.queryByTestId('ot-request-badge')).not.toBeInTheDocument();
            });
        });

        it('[ATT-OT-07] REJECTED status shows "Từ chối" badge with failure color', async () => {
            mockBothEndpoints({
                attendanceItems: [
                    {
                        date: '2026-01-10',
                        checkInAt: null,
                        checkOutAt: null,
                        status: 'ON_TIME',
                        lateMinutes: 0,
                        workMinutes: 0,
                        otMinutes: 0,
                    },
                ],
                otItems: [
                    { type: 'OT_REQUEST', date: '2026-01-10', status: 'REJECTED' },
                ],
            });

            render(
                <MemoryRouter>
                    <MyAttendancePage />
                </MemoryRouter>
            );

            await waitFor(() => {
                expect(screen.getByText('Từ chối')).toBeInTheDocument();
            });
        });
    });

    describe('6. Data Display Formatting', () => {
        it('[ATT-12] Times displayed in GMT+7 format', async () => {
            client.get.mockResolvedValue({
                data: {
                    items: [
                        {
                            date: '2026-01-10',
                            checkInAt: '2026-01-10T08:30:00+07:00',
                            checkOutAt: '2026-01-10T17:45:00+07:00',
                            status: 'ON_TIME',
                        },
                    ]
                }
            });

            render(
                <MemoryRouter>
                    <MyAttendancePage />
                </MemoryRouter>
            );

            await waitFor(() => {
                expect(screen.getByText('08:30')).toBeInTheDocument();
                expect(screen.getByText('17:45')).toBeInTheDocument();
            });
        });

        it('[ATT-13] Missing check-in/out shows placeholder', async () => {
            client.get.mockResolvedValue({
                data: {
                    items: [
                        {
                            date: '2026-01-10',
                            checkInAt: null,
                            checkOutAt: null,
                            status: 'ABSENT',
                        },
                    ]
                }
            });

            render(
                <MemoryRouter>
                    <MyAttendancePage />
                </MemoryRouter>
            );

            await waitFor(() => {
                // Should show placeholder text for missing times
                const placeholders = screen.getAllByText('--:--');
                expect(placeholders.length).toBe(2); // check-in and check-out
            });
        });
    });

    // =====================================================================
    // 8. Timezone Correctness
    // Regression: formatDate must always render the GMT+7 calendar date.
    // 2026-01-01T00:00:00+07:00 = 2025-12-31T17:00:00Z — without the
    // timeZone option, hosts running in UTC or western zones render "31/12".
    // =====================================================================
    describe('8. Timezone Correctness', () => {
        it('[ATT-TZ-01] Ngày column renders GMT+7 calendar date regardless of host timezone', async () => {
            // date '2026-01-01' midnight GMT+7 = 2025-12-31T17:00:00Z
            // Old code (no timeZone): UTC/western hosts render "31/12" (wrong)
            // Fixed code (timeZone: Asia/Ho_Chi_Minh): always renders "01/01"
            client.get.mockImplementation((url) => {
                if (url.startsWith('/attendance/me')) {
                    return Promise.resolve({
                        data: {
                            items: [
                                {
                                    date: '2026-01-01',
                                    checkInAt: '2026-01-01T08:30:00+07:00',
                                    checkOutAt: '2026-01-01T17:30:00+07:00',
                                    status: 'ON_TIME',
                                    lateMinutes: 0,
                                    workMinutes: 480,
                                    otMinutes: 0,
                                },
                            ],
                        },
                    });
                }
                // OT requests endpoint
                return Promise.resolve({
                    data: {
                        items: [],
                        pagination: { page: 1, limit: 100, total: 0, totalPages: 1 },
                    },
                });
            });

            render(
                <MemoryRouter>
                    <MyAttendancePage />
                </MemoryRouter>
            );

            await waitFor(() => {
                expect(screen.queryByRole('status')).not.toBeInTheDocument();
            });

            // GMT+7 calendar date must always display as 01/01, never 31/12
            expect(screen.getByText(/01\/01/)).toBeInTheDocument();
            expect(screen.queryByText(/31\/12/)).not.toBeInTheDocument();
        });
    });

    describe('9. Duration toggle (minutes ↔ hours)', () => {
        it('[ATT-DUR-01] toggles work minutes per-cell without affecting other cells', async () => {
            const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

            client.get.mockImplementation((url) => {
                if (url.startsWith('/attendance/me')) {
                    return Promise.resolve({
                        data: {
                            items: [
                                {
                                    date: '2026-01-10',
                                    checkInAt: '2026-01-10T02:20:00+07:00',
                                    checkOutAt: '2026-01-10T19:21:00+07:00',
                                    status: 'ON_TIME',
                                    lateMinutes: 0,
                                    workMinutes: 849,
                                    otMinutes: 120,
                                    scheduleType: 'SHIFT_1',
                                },
                            ],
                        },
                    });
                }

                if (url.startsWith('/requests/me')) {
                    return Promise.resolve({
                        data: {
                            items: [],
                            pagination: { page: 1, limit: 100, total: 0, totalPages: 1 },
                        },
                    });
                }

                return Promise.reject(new Error(`Unexpected GET: ${url}`));
            });

            render(
                <MemoryRouter>
                    <MyAttendancePage />
                </MemoryRouter>
            );

            await waitFor(() => {
                expect(screen.getByText('849 phút')).toBeInTheDocument();
                expect(screen.getByText('120 phút')).toBeInTheDocument();
            });

            const workToggle = screen.getByRole('button', { name: 'Đổi đơn vị làm việc ngày 2026-01-10' });
            await user.click(workToggle);

            expect(screen.getByText('14h 9m')).toBeInTheDocument();
            expect(screen.getByText('120 phút')).toBeInTheDocument();

            await user.click(workToggle);
            expect(screen.getByText('849 phút')).toBeInTheDocument();
        });

        it('[ATT-DUR-02] does not create toggle button for placeholder cells', async () => {
            client.get.mockImplementation((url) => {
                if (url.startsWith('/attendance/me')) {
                    return Promise.resolve({
                        data: {
                            items: [
                                {
                                    date: '2026-01-12',
                                    checkInAt: '2026-01-12T09:00:00+07:00',
                                    checkOutAt: '2026-01-12T18:00:00+07:00',
                                    status: 'ON_TIME',
                                    lateMinutes: 0,
                                    workMinutes: 0,
                                    otMinutes: 0,
                                    scheduleType: 'FLEXIBLE',
                                },
                            ],
                        },
                    });
                }

                if (url.startsWith('/requests/me')) {
                    return Promise.resolve({
                        data: {
                            items: [],
                            pagination: { page: 1, limit: 100, total: 0, totalPages: 1 },
                        },
                    });
                }

                return Promise.reject(new Error(`Unexpected GET: ${url}`));
            });

            render(
                <MemoryRouter>
                    <MyAttendancePage />
                </MemoryRouter>
            );

            await waitFor(() => {
                expect(screen.getAllByText('-').length).toBeGreaterThan(0);
            });

            expect(screen.queryByRole('button', { name: 'Đổi đơn vị đi muộn ngày 2026-01-12' })).not.toBeInTheDocument();
            expect(screen.queryByRole('button', { name: 'Đổi đơn vị làm việc ngày 2026-01-12' })).not.toBeInTheDocument();
            expect(screen.queryByRole('button', { name: 'Đổi đơn vị OT ngày 2026-01-12' })).not.toBeInTheDocument();
        });
    });
});
