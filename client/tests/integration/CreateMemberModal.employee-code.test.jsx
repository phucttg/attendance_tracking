import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CreateMemberModal from '../../src/components/modals/CreateMemberModal';
import { createUser } from '../../src/api/adminApi';

vi.mock('../../src/api/adminApi', () => ({
    createUser: vi.fn()
}));

const codeByRole = {
    EMPLOYEE: 'EMP007',
    MANAGER: 'MNG007',
    ADMIN: 'ADM007'
};

function renderModal(props = {}) {
    const onRefreshEmployeeCode = props.onRefreshEmployeeCode
        || vi.fn((role) => Promise.resolve(codeByRole[role]));

    return render(
        <CreateMemberModal
            show
            teams={[]}
            employeeCodeCache={{ EMPLOYEE: codeByRole.EMPLOYEE }}
            employeeCodeLoadingByRole={{}}
            onRefreshEmployeeCode={onRefreshEmployeeCode}
            onClose={vi.fn()}
            onSuccess={vi.fn()}
            {...props}
        />
    );
}

async function fillRequiredFields(user) {
    await user.type(screen.getByLabelText(/họ tên/i), 'Nguyen Van A');
    await user.type(screen.getByLabelText(/email/i), 'a@example.com');
    await user.type(screen.getByLabelText(/mật khẩu/i), 'Password123');
}

describe('CreateMemberModal employee code generation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        createUser.mockResolvedValue({ data: { user: { _id: 'user-1' } } });
    });

    it('renders cached EMPLOYEE code immediately and keeps the field read-only', () => {
        const onRefreshEmployeeCode = vi.fn(() => new Promise(() => {}));
        renderModal({ onRefreshEmployeeCode });

        const employeeCodeInput = screen.getByLabelText(/mã nv/i);
        expect(employeeCodeInput).toHaveValue('EMP007');
        expect(employeeCodeInput).toHaveAttribute('readonly');
        expect(onRefreshEmployeeCode).toHaveBeenCalledWith('EMPLOYEE');
    });

    it('uses cached employee code immediately when role changes', async () => {
        const user = userEvent.setup();
        const onRefreshEmployeeCode = vi.fn(() => new Promise(() => {}));
        renderModal({
            employeeCodeCache: {
                EMPLOYEE: 'EMP007',
                MANAGER: 'MNG007',
                ADMIN: 'ADM007'
            },
            onRefreshEmployeeCode
        });

        await user.selectOptions(screen.getByLabelText(/vai trò/i), 'MANAGER');

        expect(screen.getByLabelText(/mã nv/i)).toHaveValue('MNG007');
        expect(onRefreshEmployeeCode).toHaveBeenCalledWith('MANAGER');
    });

    it('keeps cached code visible and shows an inline spinner during background refresh', () => {
        renderModal({
            employeeCodeCache: { EMPLOYEE: 'EMP007' },
            employeeCodeLoadingByRole: { EMPLOYEE: true },
            onRefreshEmployeeCode: vi.fn(() => new Promise(() => {}))
        });

        expect(screen.getByLabelText(/mã nv/i)).toHaveValue('EMP007');
        expect(screen.getByLabelText(/đang làm mới mã nhân viên/i)).toBeInTheDocument();
    });

    it('allows submit with a valid cached code while background refresh is pending', async () => {
        const user = userEvent.setup();

        renderModal({
            employeeCodeCache: { EMPLOYEE: 'EMP007' },
            employeeCodeLoadingByRole: { EMPLOYEE: true },
            onRefreshEmployeeCode: vi.fn(() => new Promise(() => {}))
        });

        await fillRequiredFields(user);
        await user.click(screen.getByRole('button', { name: /tạo nhân viên/i }));

        expect(createUser).toHaveBeenCalledWith(expect.objectContaining({
            employeeCode: 'EMP007'
        }));
    });

    it('blocks submit when cached employee code format is invalid', () => {
        renderModal({
            employeeCodeCache: { EMPLOYEE: 'BAD001' },
            onRefreshEmployeeCode: vi.fn(() => Promise.resolve('BAD001'))
        });

        expect(screen.getByLabelText(/mã nv/i)).toHaveValue('BAD001');
        expect(screen.getByRole('button', { name: /tạo nhân viên/i })).toBeDisabled();
        expect(createUser).not.toHaveBeenCalled();
    });

    it('refreshes code after backend employeeCode conflict', async () => {
        const user = userEvent.setup();
        const onRefreshEmployeeCode = vi.fn()
            .mockResolvedValueOnce('EMP001')
            .mockResolvedValueOnce('EMP002');
        createUser.mockRejectedValueOnce({
            response: {
                status: 409,
                data: {
                    message: 'Employee code already exists. Please refresh the employee code and try again.'
                }
            }
        });

        renderModal({
            employeeCodeCache: { EMPLOYEE: 'EMP001' },
            onRefreshEmployeeCode
        });

        await fillRequiredFields(user);
        await user.click(screen.getByRole('button', { name: /tạo nhân viên/i }));

        await waitFor(() => {
            expect(createUser).toHaveBeenCalled();
            expect(screen.getByLabelText(/mã nv/i)).toHaveValue('EMP002');
        });
        expect(screen.getByText(/employee code already exists/i)).toBeInTheDocument();
    });

    it('keeps the conflict error visible when employee code refresh fails', async () => {
        const user = userEvent.setup();
        const refreshError = new Error('Network error');
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const onRefreshEmployeeCode = vi.fn()
            .mockResolvedValueOnce('EMP001')
            .mockRejectedValueOnce(refreshError);
        createUser.mockRejectedValueOnce({
            response: {
                status: 409,
                data: {
                    message: 'Employee code already exists. Please refresh the employee code and try again.'
                }
            }
        });

        renderModal({
            employeeCodeCache: { EMPLOYEE: 'EMP001' },
            onRefreshEmployeeCode
        });

        await fillRequiredFields(user);
        await user.click(screen.getByRole('button', { name: /tạo nhân viên/i }));

        await waitFor(() => {
            expect(screen.getByText(/không thể làm mới mã tự động/i)).toBeInTheDocument();
        });
        expect(screen.getByText(/employee code already exists/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/mã nv/i)).toHaveValue('EMP001');
        expect(screen.getByRole('button', { name: /tạo nhân viên/i })).not.toBeDisabled();
        expect(consoleErrorSpy).toHaveBeenCalledWith(
            'Failed to refresh employee code after conflict:',
            refreshError
        );
        consoleErrorSpy.mockRestore();
    });
});
