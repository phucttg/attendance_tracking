/**
 * DashboardPage Integration Tests
 * 
 * Test Design: State Transition Testing + Decision Table (ISTQB)
 * Test Type: Integration
 * Priority: HIGH
 * ISO 25010: Functional Suitability, Usability
 * 
 * Coverage:
 * - Not checked in → Check-in button visible
 * - Working → Check-out button visible
 * - Done → completion message
 * - Check-in/Check-out actions
 * - Loading and error states
 * 
 * IMPORTANT: All dates are DYNAMIC to avoid "flaky tests"
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import DashboardPage from '../../src/pages/DashboardPage';
import client from '../../src/api/client';

// Mock API client
vi.mock('../../src/api/client');

// Mock useAuth
vi.mock('../../src/context/AuthContext', () => ({
    useAuth: vi.fn(() => ({
        user: { _id: '1', name: 'Employee', role: 'EMPLOYEE' },
        token: 'test-token',
        loading: false,
    })),
}));

describe('DashboardPage - Integration Tests', () => {
    // =====================================================
    // DYNAMIC DATE HELPERS - Prevents "flaky tests"
    // =====================================================

    // Get today's date string in YYYY-MM-DD format (GMT+7)
    const getTodayStr = () => new Date().toLocaleDateString('sv-SE', {
        timeZone: 'Asia/Ho_Chi_Minh',
    });

    // Get ISO string for a specific time TODAY (GMT+7)
    const getTodayIsoAt = (hour, minute) => {
        const today = getTodayStr();
        const pad = (n) => String(n).padStart(2, '0');
        return `${today}T${pad(hour)}:${pad(minute)}:00+07:00`;
    };

    // Get date string N days before a date key (YYYY-MM-DD)
    const minusDays = (dateKey, days) => {
        const [y, m, d] = dateKey.split('-').map(Number);
        const date = new Date(Date.UTC(y, m - 1, d - days));
        return date.toISOString().slice(0, 10);
    };

    // Get ISO string for a specific time on a given date key (GMT+7)
    const getIsoAtDate = (dateKey, hour, minute) => {
        const pad = (n) => String(n).padStart(2, '0');
        return `${dateKey}T${pad(hour)}:${pad(minute)}:00+07:00`;
    };

    const getPreviousMonthDate = (dateKey) => {
        const [year, month] = dateKey.slice(0, 7).split('-').map(Number);
        const previousMonth = month === 1 ? 12 : month - 1;
        const previousYear = month === 1 ? year - 1 : year;
        return `${previousYear}-${String(previousMonth).padStart(2, '0')}-28`;
    };

    const makeTodayEmptyRecord = () => ({
        date: today,
        checkInAt: null,
        checkOutAt: null,
        lateMinutes: 0,
        workMinutes: 0,
        otMinutes: 0,
        otApproved: false,
    });

    const makeOpenSessionContext = (date, checkInAt) => ({
        openSessionCount: 1,
        hasAnomaly: false,
        openSession: {
            attendanceId: 'att-open-1',
            date,
            checkInAt,
        },
        needsReconciliationCount: 0,
        needsReconciliation: [],
    });

    const emptyOpenSessionContext = () => ({
        openSessionCount: 0,
        hasAnomaly: false,
        openSession: null,
        needsReconciliationCount: 0,
        needsReconciliation: [],
    });

    const setupDashboardGetMocks = ({
        currentMonthItems,
        openSessionContext,
        extraMonthItems = {},
    }) => {
        client.get.mockImplementation((url) => {
            if (url.startsWith('/attendance/me?month=')) {
                const month = url.slice('/attendance/me?month='.length);
                if (month === currentMonth) {
                    return Promise.resolve({ data: { items: currentMonthItems } });
                }
                return Promise.resolve({
                    data: { items: Array.isArray(extraMonthItems[month]) ? extraMonthItems[month] : [] }
                });
            }
            if (url === '/attendance/open-session') {
                return Promise.resolve({ data: openSessionContext });
            }
            return Promise.reject(new Error(`Unexpected GET: ${url}`));
        });
    };

    // Current values for this test run
    const today = getTodayStr();
    const currentMonth = today.slice(0, 7);

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('1. Initial States', () => {
        it('[DASH-01] Shows loading spinner while fetching attendance', async () => {
            // Never resolve the promise
            client.get.mockImplementation(() => new Promise(() => { }));

            render(
                <MemoryRouter>
                    <DashboardPage />
                </MemoryRouter>
            );

            // Should show spinner
            expect(screen.getByRole('status')).toBeInTheDocument();
        });

        it('[DASH-02] NOT_CHECKED_IN state shows check-in button', async () => {
            client.get.mockResolvedValue({
                data: { items: [] } // No attendance record
            });

            render(
                <MemoryRouter>
                    <DashboardPage />
                </MemoryRouter>
            );

            // Wait for loading to complete
            await waitFor(() => {
                expect(screen.queryByRole('status')).not.toBeInTheDocument();
            });

            // Check-in button visible
            expect(screen.getByRole('button', { name: /check-in/i })).toBeInTheDocument();

            // Status badge
            expect(screen.getByText(/chưa check-in/i)).toBeInTheDocument();
        });

        it('[DASH-03] WORKING state shows check-out button', async () => {
            // DYNAMIC: Use today's date for both date and checkInAt
            client.get.mockResolvedValue({
                data: {
                    items: [{
                        date: today,                           // Dynamic date
                        checkInAt: getTodayIsoAt(8, 30),       // Dynamic: 08:30 today
                        checkOutAt: null,
                        lateMinutes: 0,
                        workMinutes: 120,
                        otMinutes: 0,
                    }]
                }
            });

            render(
                <MemoryRouter>
                    <DashboardPage />
                </MemoryRouter>
            );

            await waitFor(() => {
                expect(screen.queryByRole('status')).not.toBeInTheDocument();
            });

            // Check-out button visible
            expect(screen.getByRole('button', { name: /check-out/i })).toBeInTheDocument();

            // Status badge - working
            expect(screen.getByText(/đang làm việc/i)).toBeInTheDocument();

            // Check-in time displayed
            expect(screen.getByText('08:30')).toBeInTheDocument();
        });

        it('[DASH-04] DONE state shows completion message', async () => {
            // DYNAMIC dates
            client.get.mockResolvedValue({
                data: {
                    items: [{
                        date: today,
                        checkInAt: getTodayIsoAt(8, 30),      // 08:30 today
                        checkOutAt: getTodayIsoAt(17, 30),   // 17:30 today
                        lateMinutes: 0,
                        workMinutes: 480,
                        otMinutes: 0,
                    }]
                }
            });

            render(
                <MemoryRouter>
                    <DashboardPage />
                </MemoryRouter>
            );

            await waitFor(() => {
                expect(screen.queryByRole('status')).not.toBeInTheDocument();
            });

            // Completion message
            expect(screen.getByText(/bạn đã hoàn thành ngày làm việc/i)).toBeInTheDocument();

            // Status badge - done
            expect(screen.getByText(/đã check-out/i)).toBeInTheDocument();

            // Both times displayed
            expect(screen.getByText('08:30')).toBeInTheDocument();
            expect(screen.getByText('17:30')).toBeInTheDocument();
        });
    });

    describe('2. Check-in Action', () => {
        it('[DASH-05] Check-in button triggers API and RELOADS data', async () => {
            const user = userEvent.setup();

            // Initial: not checked in
            client.get.mockResolvedValueOnce({ data: { items: [] } });

            // After check-in: working (refetch response)
            client.get.mockResolvedValueOnce({
                data: {
                    items: [{
                        date: today,
                        checkInAt: getTodayIsoAt(8, 45),  // Dynamic
                        checkOutAt: null,
                    }]
                }
            });

            client.post.mockResolvedValue({ data: { message: 'Checked in' } });

            render(
                <MemoryRouter>
                    <DashboardPage />
                </MemoryRouter>
            );

            // Wait for initial load
            await waitFor(() => {
                expect(screen.getByRole('button', { name: /check-in/i })).toBeInTheDocument();
            });

            // Click check-in
            await user.click(screen.getByRole('button', { name: /check-in/i }));

            // API called correctly
            await waitFor(() => {
                expect(client.post).toHaveBeenCalledWith('/attendance/check-in');
            });

            // VERIFY REFETCH: GET should be called twice (initial + after action)
            await waitFor(() => {
                expect(client.get).toHaveBeenCalledTimes(2);
            });

            // UI updates to show check-out button
            await waitFor(() => {
                expect(screen.getByRole('button', { name: /check-out/i })).toBeInTheDocument();
            });
        });

        it('[DASH-06] Check-in error displays alert', async () => {
            const user = userEvent.setup();

            client.get.mockResolvedValue({ data: { items: [] } });
            client.post.mockRejectedValue({
                response: { data: { message: 'Already checked in today' } }
            });

            render(
                <MemoryRouter>
                    <DashboardPage />
                </MemoryRouter>
            );

            await waitFor(() => {
                expect(screen.getByRole('button', { name: /check-in/i })).toBeInTheDocument();
            });

            await user.click(screen.getByRole('button', { name: /check-in/i }));

            // Error alert shown
            const alert = await screen.findByRole('alert');
            expect(alert).toHaveTextContent('Already checked in today');
        });
    });

    describe('3. Check-out Action', () => {
        it('[DASH-07] Check-out button triggers API and RELOADS data', async () => {
            const user = userEvent.setup();

            // Initial: working
            client.get.mockResolvedValueOnce({
                data: {
                    items: [{
                        date: today,
                        checkInAt: getTodayIsoAt(8, 30),
                        checkOutAt: null,
                    }]
                }
            });

            // After check-out: done
            client.get.mockResolvedValueOnce({
                data: {
                    items: [{
                        date: today,
                        checkInAt: getTodayIsoAt(8, 30),
                        checkOutAt: getTodayIsoAt(17, 30),
                    }]
                }
            });

            client.post.mockResolvedValue({ data: { message: 'Checked out' } });

            render(
                <MemoryRouter>
                    <DashboardPage />
                </MemoryRouter>
            );

            await waitFor(() => {
                expect(screen.getByRole('button', { name: /check-out/i })).toBeInTheDocument();
            });

            await user.click(screen.getByRole('button', { name: /check-out/i }));

            await waitFor(() => {
                expect(client.post).toHaveBeenCalledWith('/attendance/check-out');
            });

            // VERIFY REFETCH
            await waitFor(() => {
                expect(client.get).toHaveBeenCalledTimes(2);
            });

            // UI updates to show completion
            await waitFor(() => {
                expect(screen.getByText(/bạn đã hoàn thành ngày làm việc/i)).toBeInTheDocument();
            });
        });
    });

    describe('4. Data Display', () => {
        it('[DASH-08] Late minutes displayed when checked in late', async () => {
            client.get.mockResolvedValue({
                data: {
                    items: [{
                        date: today,
                        checkInAt: getTodayIsoAt(9, 0),  // 09:00 (late)
                        checkOutAt: null,
                        lateMinutes: 15,
                        workMinutes: 60,
                        otMinutes: 0,
                    }]
                }
            });

            render(
                <MemoryRouter>
                    <DashboardPage />
                </MemoryRouter>
            );

            await waitFor(() => {
                expect(screen.getByText('15 phút')).toBeInTheDocument();
            });

            // Should show late section
            expect(screen.getByText(/đi muộn/i)).toBeInTheDocument();
        });

        it('[DASH-09] OT minutes displayed when working overtime', async () => {
            client.get.mockResolvedValue({
                data: {
                    items: [{
                        date: today,
                        checkInAt: getTodayIsoAt(8, 30),
                        checkOutAt: getTodayIsoAt(19, 30),  // 19:30 (overtime)
                        lateMinutes: 0,
                        workMinutes: 540,
                        otMinutes: 60,
                    }]
                }
            });

            render(
                <MemoryRouter>
                    <DashboardPage />
                </MemoryRouter>
            );

            await waitFor(() => {
                expect(screen.getByText('60 phút')).toBeInTheDocument();
            });

            // OT section visible
            expect(screen.getByText(/ot/i)).toBeInTheDocument();
        });
    });

    describe('5. Error Handling', () => {
        it('[DASH-10] API error shows alert with dismiss button', async () => {
            const user = userEvent.setup();

            client.get.mockRejectedValue({
                response: { data: { message: 'Server error' } }
            });

            render(
                <MemoryRouter>
                    <DashboardPage />
                </MemoryRouter>
            );

            const alert = await screen.findByRole('alert');
            expect(alert).toHaveTextContent('Server error');

            // Dismiss button works
            const dismissButton = screen.getByRole('button', { name: /dismiss/i });
            await user.click(dismissButton);

            await waitFor(() => {
                expect(screen.queryByRole('alert')).not.toBeInTheDocument();
            });
        });
    });

    describe('6. Cross-Midnight Fact Check', () => {
        it('[DASH-CM-01] approved cross-midnight session shows check-out button', async () => {
            const yesterday = minusDays(today, 1);
            const yesterdayMonth = yesterday.slice(0, 7);
            const todayEmpty = makeTodayEmptyRecord();
            const yesterdayApprovedRecord = {
                date: yesterday,
                checkInAt: getIsoAtDate(yesterday, 8, 0),
                checkOutAt: null,
                lateMinutes: 0,
                workMinutes: 0,
                otMinutes: 0,
                otApproved: true,
            };

            const currentMonthItems = [todayEmpty];
            const extraMonthItems = {};
            if (yesterdayMonth === currentMonth) {
                currentMonthItems.push(yesterdayApprovedRecord);
            } else {
                extraMonthItems[yesterdayMonth] = [yesterdayApprovedRecord];
            }

            setupDashboardGetMocks({
                currentMonthItems,
                openSessionContext: makeOpenSessionContext(yesterday, getIsoAtDate(yesterday, 8, 0)),
                extraMonthItems,
            });

            render(
                <MemoryRouter>
                    <DashboardPage />
                </MemoryRouter>
            );

            await waitFor(() => {
                expect(screen.queryByRole('status')).not.toBeInTheDocument();
            });

            expect(screen.getByRole('button', { name: /check-out/i })).toBeInTheDocument();
            expect(screen.queryByRole('button', { name: /check-in/i })).not.toBeInTheDocument();
            expect(screen.getByText(/đang làm việc/i)).toBeInTheDocument();
        });

        it('[DASH-CM-02] approved cross-midnight checkout shows success feedback and returns to today not-checked-in', async () => {
            const user = userEvent.setup();
            const yesterday = minusDays(today, 1);
            const yesterdayMonth = yesterday.slice(0, 7);
            const todayEmpty = makeTodayEmptyRecord();
            const yesterdayApprovedRecord = {
                date: yesterday,
                checkInAt: getIsoAtDate(yesterday, 8, 0),
                checkOutAt: null,
                lateMinutes: 0,
                workMinutes: 0,
                otMinutes: 0,
                otApproved: true,
            };

            const currentMonthItems = [todayEmpty];
            const extraMonthItems = {};
            if (yesterdayMonth === currentMonth) {
                currentMonthItems.push(yesterdayApprovedRecord);
            } else {
                extraMonthItems[yesterdayMonth] = [yesterdayApprovedRecord];
            }

            let openSessionContext = makeOpenSessionContext(yesterday, getIsoAtDate(yesterday, 8, 0));
            client.get.mockImplementation((url) => {
                if (url.startsWith('/attendance/me?month=')) {
                    const month = url.slice('/attendance/me?month='.length);
                    if (month === currentMonth) {
                        return Promise.resolve({ data: { items: currentMonthItems } });
                    }
                    return Promise.resolve({
                        data: { items: Array.isArray(extraMonthItems[month]) ? extraMonthItems[month] : [] }
                    });
                }
                if (url === '/attendance/open-session') {
                    return Promise.resolve({ data: openSessionContext });
                }
                return Promise.reject(new Error(`Unexpected GET: ${url}`));
            });
            client.post.mockImplementation((url) => {
                if (url === '/attendance/check-out') {
                    openSessionContext = emptyOpenSessionContext();
                    return Promise.resolve({ data: { message: 'Checked out' } });
                }
                return Promise.reject(new Error(`Unexpected POST: ${url}`));
            });

            render(
                <MemoryRouter>
                    <DashboardPage />
                </MemoryRouter>
            );

            await waitFor(() => {
                expect(screen.queryByRole('status')).not.toBeInTheDocument();
            });

            await user.click(screen.getByRole('button', { name: /check-out/i }));

            await waitFor(() => {
                expect(client.post).toHaveBeenCalledWith('/attendance/check-out');
            });

            await waitFor(() => {
                expect(screen.getByText('Đã check-out ca OT ngày trước')).toBeInTheDocument();
            });

            await waitFor(() => {
                expect(screen.getByRole('button', { name: /check-in/i })).toBeInTheDocument();
            });
            expect(screen.queryByRole('button', { name: /check-out/i })).not.toBeInTheDocument();
            expect(screen.getByText(/chưa check-in/i)).toBeInTheDocument();
        });

        it('[DASH-CM-03] unapproved cross-midnight session remains unchanged (shows check-in)', async () => {
            const yesterday = minusDays(today, 1);
            const yesterdayMonth = yesterday.slice(0, 7);
            const todayEmpty = makeTodayEmptyRecord();
            const yesterdayUnapprovedRecord = {
                date: yesterday,
                checkInAt: getIsoAtDate(yesterday, 8, 0),
                checkOutAt: null,
                lateMinutes: 0,
                workMinutes: 0,
                otMinutes: 0,
                otApproved: false,
            };

            const currentMonthItems = [todayEmpty];
            const extraMonthItems = {};
            if (yesterdayMonth === currentMonth) {
                currentMonthItems.push(yesterdayUnapprovedRecord);
            } else {
                extraMonthItems[yesterdayMonth] = [yesterdayUnapprovedRecord];
            }

            setupDashboardGetMocks({
                currentMonthItems,
                openSessionContext: makeOpenSessionContext(yesterday, getIsoAtDate(yesterday, 8, 0)),
                extraMonthItems,
            });

            render(
                <MemoryRouter>
                    <DashboardPage />
                </MemoryRouter>
            );

            await waitFor(() => {
                expect(screen.queryByRole('status')).not.toBeInTheDocument();
            });

            expect(screen.queryByRole('button', { name: /check-out/i })).not.toBeInTheDocument();
            expect(screen.getByRole('button', { name: /check-in/i })).toBeInTheDocument();
            expect(screen.getByText(/chưa check-in/i)).toBeInTheDocument();
        });

        it('[DASH-CM-04] unapproved cross-midnight check-in attempt is still blocked by backend', async () => {
            const user = userEvent.setup();
            const yesterday = minusDays(today, 1);
            const yesterdayMonth = yesterday.slice(0, 7);
            const todayEmpty = makeTodayEmptyRecord();
            const yesterdayUnapprovedRecord = {
                date: yesterday,
                checkInAt: getIsoAtDate(yesterday, 8, 0),
                checkOutAt: null,
                lateMinutes: 0,
                workMinutes: 0,
                otMinutes: 0,
                otApproved: false,
            };

            const currentMonthItems = [todayEmpty];
            const extraMonthItems = {};
            if (yesterdayMonth === currentMonth) {
                currentMonthItems.push(yesterdayUnapprovedRecord);
            } else {
                extraMonthItems[yesterdayMonth] = [yesterdayUnapprovedRecord];
            }

            setupDashboardGetMocks({
                currentMonthItems,
                openSessionContext: makeOpenSessionContext(yesterday, getIsoAtDate(yesterday, 8, 0)),
                extraMonthItems,
            });

            client.post.mockRejectedValue({
                response: {
                    data: {
                        message: `You have an open session from ${yesterday}. Please checkout first.`,
                    }
                }
            });

            render(
                <MemoryRouter>
                    <DashboardPage />
                </MemoryRouter>
            );

            await waitFor(() => {
                expect(screen.getByRole('button', { name: /check-in/i })).toBeInTheDocument();
            });

            await user.click(screen.getByRole('button', { name: /check-in/i }));

            await waitFor(() => {
                expect(client.post).toHaveBeenCalledWith('/attendance/check-in');
            });

            const alert = await screen.findByRole('alert');
            expect(alert).toHaveTextContent(`open session from ${yesterday}`);
        });

        it('[DASH-CM-05] month boundary: approved open session from previous month still shows check-out', async () => {
            const previousMonthDate = getPreviousMonthDate(today);
            const previousMonth = previousMonthDate.slice(0, 7);
            const todayEmpty = makeTodayEmptyRecord();
            const previousMonthApprovedRecord = {
                date: previousMonthDate,
                checkInAt: getIsoAtDate(previousMonthDate, 8, 0),
                checkOutAt: null,
                lateMinutes: 0,
                workMinutes: 0,
                otMinutes: 0,
                otApproved: true,
            };

            setupDashboardGetMocks({
                currentMonthItems: [todayEmpty],
                openSessionContext: makeOpenSessionContext(previousMonthDate, getIsoAtDate(previousMonthDate, 8, 0)),
                extraMonthItems: {
                    [previousMonth]: [previousMonthApprovedRecord],
                },
            });

            render(
                <MemoryRouter>
                    <DashboardPage />
                </MemoryRouter>
            );

            await waitFor(() => {
                expect(screen.getByRole('button', { name: /check-out/i })).toBeInTheDocument();
            });

            const hasPreviousMonthFetch = client.get.mock.calls.some(([url]) =>
                url === `/attendance/me?month=${previousMonth}`
            );
            expect(hasPreviousMonthFetch).toBe(true);
        });
    });
});
