import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import AdminHolidaysPage from '../../src/pages/AdminHolidaysPage';
import * as adminApi from '../../src/api/adminApi';

vi.mock('../../src/api/adminApi', () => ({
    getHolidays: vi.fn(),
    createHoliday: vi.fn(),
    createHolidayRange: vi.fn(),
    deleteHoliday: vi.fn()
}));

describe('AdminHolidaysPage - Freeze Delete UI', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders locked holiday rows as disabled "Đã khóa"', async () => {
        adminApi.getHolidays.mockResolvedValue({
            data: {
                items: [
                    { _id: '1', date: '2026-03-21', name: 'Past Holiday', isLocked: true },
                    { _id: '2', date: '2026-03-23', name: 'Future Holiday', isLocked: false }
                ]
            }
        });

        render(<AdminHolidaysPage />);

        await waitFor(() => {
            expect(adminApi.getHolidays).toHaveBeenCalled();
        });

        expect(screen.getByRole('button', { name: /đã khóa/i })).toBeDisabled();
        expect(screen.getByRole('button', { name: /^xóa$/i })).toBeEnabled();
    });
});
