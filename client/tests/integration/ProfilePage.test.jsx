import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import ProfilePage from '../../src/pages/ProfilePage';
import { useAuth } from '../../src/context/AuthContext';
import { getTeams } from '../../src/api/memberApi';

vi.mock('../../src/context/AuthContext', () => ({
    useAuth: vi.fn(),
}));

vi.mock('../../src/api/memberApi', () => ({
    getTeams: vi.fn(),
}));

describe('ProfilePage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    const fieldValue = (label) => screen.getByText(label).nextElementSibling;

    it('renders current user profile fields from AuthContext', async () => {
        const startDate = '2026-01-15T00:00:00.000Z';
        useAuth.mockReturnValue({
            user: {
                _id: 'user-1',
                name: 'Employee User',
                email: 'employee@company.com',
                username: 'employee',
                role: 'EMPLOYEE',
                employeeCode: 'NV003',
                teamId: 'team-1',
                startDate,
            },
        });
        getTeams.mockResolvedValue({
            data: { items: [{ _id: 'team-1', name: 'Engineering' }] },
        });

        render(<ProfilePage />);

        expect(screen.getByText('Employee User')).toBeInTheDocument();
        expect(screen.getByText('employee@company.com')).toBeInTheDocument();
        expect(screen.getByText('employee')).toBeInTheDocument();
        expect(screen.getByText('NV003')).toBeInTheDocument();
        expect(screen.getByText('EMPLOYEE')).toBeInTheDocument();
        expect(await screen.findByText('Engineering')).toBeInTheDocument();
        expect(getTeams).toHaveBeenCalledTimes(1);
        expect(screen.getByText(new Date(startDate).toLocaleDateString('vi-VN', {
            timeZone: 'Asia/Ho_Chi_Minh',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
        }))).toBeInTheDocument();
    });

    it('shows a fallback instead of a blank email value', () => {
        useAuth.mockReturnValue({
            user: {
                _id: 'user-1',
                name: 'Employee User',
                role: 'EMPLOYEE',
                employeeCode: 'NV003',
            },
        });

        render(<ProfilePage />);

        expect(fieldValue('Email')).toHaveTextContent('-');
        expect(getTeams).not.toHaveBeenCalled();
    });

    it('shows fallbacks for missing username, start date, and team', () => {
        useAuth.mockReturnValue({
            user: {
                _id: 'user-1',
                name: 'Employee User',
                email: 'employee@company.com',
                role: 'EMPLOYEE',
                employeeCode: 'NV003',
            },
        });

        render(<ProfilePage />);

        expect(fieldValue('Email')).toHaveTextContent('employee@company.com');
        expect(fieldValue('Username')).toHaveTextContent('-');
        expect(fieldValue('Team')).toHaveTextContent('-');
        expect(fieldValue('Ngày bắt đầu')).toHaveTextContent('-');
        expect(getTeams).not.toHaveBeenCalled();
    });

    it('shows an error value when loading the team name fails', async () => {
        useAuth.mockReturnValue({
            user: {
                _id: 'user-1',
                name: 'Employee User',
                email: 'employee@company.com',
                role: 'EMPLOYEE',
                employeeCode: 'NV003',
                teamId: 'team-1',
            },
        });
        getTeams.mockRejectedValue(new Error('Network Error'));

        render(<ProfilePage />);

        expect(await screen.findByText('Error loading')).toBeInTheDocument();
        expect(fieldValue('Team')).toHaveTextContent('Error loading');
        expect(getTeams).toHaveBeenCalledTimes(1);
    });

    it('renders profile values as text and does not create DOM from HTML payloads', () => {
        const xssName = '<img src=x onerror=alert(1)>';
        const xssEmail = '<script>alert(1)</script>@company.com';

        useAuth.mockReturnValue({
            user: {
                _id: 'user-1',
                name: xssName,
                email: xssEmail,
                username: 'employee',
                role: 'EMPLOYEE',
                employeeCode: 'NV003',
            },
        });

        const { container } = render(<ProfilePage />);

        expect(screen.getByText(xssName)).toBeInTheDocument();
        expect(screen.getByText(xssEmail)).toBeInTheDocument();
        expect(container.querySelector('img')).toBeNull();
        expect(container.querySelector('script')).toBeNull();
    });
});
