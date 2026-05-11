import { useState, useEffect, useRef } from 'react';
import { Modal, Button, Label, TextInput, Select, Alert, Spinner } from 'flowbite-react';
import { HiCheck } from 'react-icons/hi';
import { createUser } from '../../api/adminApi';
import { isValidEmail, MAX_LENGTHS } from '../../utils/validation';

const DEFAULT_FORM = {
    employeeCode: '',
    name: '',
    email: '',
    username: '',
    password: '',
    role: 'EMPLOYEE',
    teamId: '',
    startDate: '',
    isActive: true
};

const EMPLOYEE_CODE_PATTERN_BY_ROLE = Object.freeze({
    ADMIN: /^ADM\d{3,}$/,
    MANAGER: /^MNG\d{3,}$/,
    EMPLOYEE: /^EMP\d{3,}$/
});

function isEmployeeCodeValidForRole(employeeCode, role) {
    return Boolean(EMPLOYEE_CODE_PATTERN_BY_ROLE[role]?.test(employeeCode.trim()));
}

function isEmployeeCodeConflict(error) {
    const message = error?.response?.data?.message || '';
    return error?.response?.status === 409 && /employee code|mã nhân viên/i.test(message);
}

/**
 * Modal for creating a new member/user.
 * Extracted from AdminMembersPage.jsx.
 * 
 * Features:
 * - Form validation with proper error messages
 * - Loading state with double-submit protection
 * - Reset form on close/success
 * - isMountedRef to prevent setState after unmount
 * - Safe callback handling (won't crash if parent throws)
 * 
 * @param {Object} props
 * @param {boolean} props.show - Modal visibility
 * @param {Array} props.teams - List of teams for dropdown [{ _id, name }]
 * @param {Object} props.employeeCodeCache - Role-keyed next employee code cache
 * @param {Object} props.employeeCodeLoadingByRole - Role-keyed loading state for code refresh
 * @param {Function} props.onRefreshEmployeeCode - Refresh handler (role) => Promise<string>
 * @param {Function} props.onClose - Close handler () => void
 * @param {Function} props.onSuccess - Called after successful creation () => void
 */
export default function CreateMemberModal({
    show,
    teams,
    employeeCodeCache = {},
    employeeCodeLoadingByRole = {},
    onRefreshEmployeeCode,
    onClose,
    onSuccess
}) {
    // ═══════════════════════════════════════════════════════════════════════
    // FORM STATE
    // ═══════════════════════════════════════════════════════════════════════

    const [form, setForm] = useState(DEFAULT_FORM);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const activeEmployeeCode = form.employeeCode || (show ? employeeCodeCache[form.role] || '' : '');
    const codeLoading = Boolean(employeeCodeLoadingByRole[form.role]);

    // ═══════════════════════════════════════════════════════════════════════
    // P1 FIX: isMountedRef to prevent setState after unmount
    // ═══════════════════════════════════════════════════════════════════════

    const isMountedRef = useRef(true);

    useEffect(() => {
        isMountedRef.current = true;
        return () => {
            isMountedRef.current = false;
        };
    }, []);

    // ═══════════════════════════════════════════════════════════════════════
    // P2 FIX: Reset form when modal closes (prevents flicker)
    // Inline logic to avoid eslint exhaustive-deps warning
    // ═══════════════════════════════════════════════════════════════════════

    useEffect(() => {
        if (!show) {
            setForm(DEFAULT_FORM);
            setError('');
        }
    }, [show]);

    useEffect(() => {
        if (!show) return;

        setForm((currentForm) => {
            const cachedCode = employeeCodeCache[currentForm.role] || '';
            if (!cachedCode || currentForm.employeeCode === cachedCode) {
                return currentForm;
            }
            return { ...currentForm, employeeCode: cachedCode };
        });
    }, [show, employeeCodeCache]);

    useEffect(() => {
        if (!show || !onRefreshEmployeeCode) return;

        onRefreshEmployeeCode(form.role).catch((err) => {
            console.error('Failed to refresh employee code:', err);
        });
    }, [show, form.role, onRefreshEmployeeCode]);

    // ═══════════════════════════════════════════════════════════════════════
    // VALIDATION
    // P2 FIX: Trim password to prevent whitespace-only passwords
    // ═══════════════════════════════════════════════════════════════════════

    const validateForm = () => {
        if (!form.role) return 'Vui lòng chọn vai trò';
        if (!activeEmployeeCode.trim()) return 'Không sinh được mã nhân viên. Vui lòng thử lại';
        if (!isEmployeeCodeValidForRole(activeEmployeeCode, form.role)) {
            return 'Mã nhân viên không đúng định dạng của vai trò đã chọn';
        }
        if (!form.name.trim()) return 'Vui lòng nhập họ tên';
        if (!form.email.trim()) return 'Vui lòng nhập email';
        if (!isValidEmail(form.email)) return 'Email không hợp lệ';
        if (!form.password) return 'Vui lòng nhập mật khẩu';
        // P2 FIX: Trim password before length check to prevent whitespace-only passwords
        if (form.password.trim().length < 8) return 'Mật khẩu phải có ít nhất 8 ký tự';
        return null;
    };

    // ═══════════════════════════════════════════════════════════════════════
    // SUBMIT HANDLER
    // P1 FIX: Double submit guard, isMountedRef check, safe callbacks
    // ═══════════════════════════════════════════════════════════════════════

    const handleSubmit = async () => {
        // P1 FIX: Guard against double submit
        if (loading) return;

        const validationError = validateForm();
        if (validationError) {
            setError(validationError);
            return;
        }

        setLoading(true);
        setError('');

        try {
            const payload = {
                employeeCode: activeEmployeeCode.trim(),
                name: form.name.trim(),
                email: form.email.trim(),
                password: form.password, // Backend will hash, don't trim here
                role: form.role,
            };

            // Optional fields - only send if not empty
            if (form.username.trim()) payload.username = form.username.trim();
            if (form.teamId) payload.teamId = form.teamId;
            if (form.startDate) payload.startDate = form.startDate;
            // isActive is always boolean, no need to check !== undefined
            payload.isActive = form.isActive;

            const res = await createUser(payload);
            const createdUser = res.data?.user || { role: form.role, employeeCode: activeEmployeeCode.trim() };

            // Success - P1 FIX: Wrap callbacks in try-catch to prevent crash
            // Call onClose first (modal closes), then onSuccess (parent refreshes data)
            try { onClose?.(); } catch (e) { console.error('onClose error:', e); }
            try { onSuccess?.(createdUser); } catch (e) { console.error('onSuccess error:', e); }
            // Note: resetForm is handled by useEffect when show becomes false
        } catch (err) {
            // P1 FIX: Only set error if still mounted
            if (isMountedRef.current) {
                const errorMessage = err.response?.data?.message || 'Tạo nhân viên thất bại';
                setError(errorMessage);
                if (isEmployeeCodeConflict(err) && onRefreshEmployeeCode) {
                    try {
                        const refreshedCode = await onRefreshEmployeeCode(form.role);
                        if (isMountedRef.current && refreshedCode) {
                            setForm((currentForm) => ({ ...currentForm, employeeCode: refreshedCode }));
                        }
                    } catch (refreshErr) {
                        console.error('Failed to refresh employee code after conflict:', refreshErr);
                        if (isMountedRef.current) {
                            setError(`${errorMessage} Không thể làm mới mã tự động. Vui lòng thử lại.`);
                        }
                    }
                }
            }
        } finally {
            // P1 FIX: Only setLoading if still mounted
            if (isMountedRef.current) {
                setLoading(false);
            }
        }
    };

    // ═══════════════════════════════════════════════════════════════════════
    // CLOSE HANDLER
    // ═══════════════════════════════════════════════════════════════════════

    const handleClose = () => {
        if (loading) return; // Prevent close during loading
        onClose();
        // Note: resetForm is handled by useEffect when show becomes false
    };

    // ═══════════════════════════════════════════════════════════════════════
    // RENDER
    // ═══════════════════════════════════════════════════════════════════════

    return (
        <Modal show={show} onClose={handleClose}>
            <Modal.Header>Thêm nhân viên mới</Modal.Header>
            <Modal.Body>
                {error && (
                    <Alert color="failure" className="mb-4">{error}</Alert>
                )}
                <div className="space-y-4">
                    {/* Row 1: Employee Code + Role */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <Label htmlFor="create-employeeCode" value="Mã NV *" />
                            <div className="relative">
                                <TextInput
                                    id="create-employeeCode"
                                    value={activeEmployeeCode}
                                    readOnly
                                    placeholder={codeLoading ? 'Đang sinh mã...' : 'EMP001'}
                                    maxLength={MAX_LENGTHS.employeeCode}
                                    autoComplete="off"
                                />
                                {codeLoading && (
                                    <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
                                        <Spinner size="sm" aria-label="Đang làm mới mã nhân viên" />
                                    </div>
                                )}
                            </div>
                        </div>
                        <div>
                            <Label htmlFor="create-role" value="Vai trò *" />
                            <Select
                                id="create-role"
                                value={form.role}
                                onChange={(e) => {
                                    const nextRole = e.target.value;
                                    setForm({
                                        ...form,
                                        role: nextRole,
                                        employeeCode: employeeCodeCache[nextRole] || ''
                                    });
                                }}
                            >
                                <option value="EMPLOYEE">EMPLOYEE</option>
                                <option value="MANAGER">MANAGER</option>
                                <option value="ADMIN">ADMIN</option>
                            </Select>
                        </div>
                    </div>

                    {/* Name */}
                    <div>
                        <Label htmlFor="create-name" value="Họ tên *" />
                        <TextInput
                            id="create-name"
                            value={form.name}
                            onChange={(e) => setForm({ ...form, name: e.target.value })}
                            placeholder="Nguyễn Văn A"
                            maxLength={MAX_LENGTHS.name}
                            autoComplete="off"
                        />
                    </div>

                    {/* Email */}
                    <div>
                        <Label htmlFor="create-email" value="Email *" />
                        <TextInput
                            id="create-email"
                            type="email"
                            value={form.email}
                            onChange={(e) => setForm({ ...form, email: e.target.value })}
                            placeholder="user@company.com"
                            maxLength={MAX_LENGTHS.email}
                            autoComplete="off"
                        />
                    </div>

                    {/* Username (optional) */}
                    <div>
                        <Label htmlFor="create-username" value="Tên đăng nhập" />
                        <TextInput
                            id="create-username"
                            value={form.username}
                            onChange={(e) => setForm({ ...form, username: e.target.value })}
                            placeholder="Không bắt buộc"
                            maxLength={MAX_LENGTHS.username}
                            autoComplete="off"
                        />
                    </div>

                    {/* Password */}
                    <div>
                        <Label htmlFor="create-password" value="Mật khẩu *" />
                        <TextInput
                            id="create-password"
                            type="password"
                            value={form.password}
                            onChange={(e) => setForm({ ...form, password: e.target.value })}
                            placeholder="Tối thiểu 8 ký tự"
                            maxLength={MAX_LENGTHS.password}
                            autoComplete="new-password"
                        />
                    </div>

                    {/* Team (optional) */}
                    <div>
                        <Label htmlFor="create-teamId" value="Nhóm" />
                        <Select
                            id="create-teamId"
                            value={form.teamId}
                            onChange={(e) => setForm({ ...form, teamId: e.target.value })}
                        >
                            <option value="">Chọn nhóm...</option>
                            {(teams || []).map((team) => (
                                <option key={team._id} value={team._id}>
                                    {team.name}
                                </option>
                            ))}
                        </Select>
                    </div>

                    {/* Row: Start Date + Status */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <Label htmlFor="create-startDate" value="Ngày bắt đầu" />
                            <TextInput
                                id="create-startDate"
                                type="date"
                                value={form.startDate}
                                onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                            />
                        </div>
                        <div>
                            <Label htmlFor="create-isActive" value="Trạng thái" />
                            <Select
                                id="create-isActive"
                                value={form.isActive.toString()}
                                onChange={(e) => setForm({ ...form, isActive: e.target.value === 'true' })}
                            >
                                <option value="true">Đang hoạt động</option>
                                <option value="false">Ngừng hoạt động</option>
                            </Select>
                        </div>
                    </div>
                </div>
            </Modal.Body>
            <Modal.Footer>
                <Button
                    onClick={handleSubmit}
                    disabled={loading || !isEmployeeCodeValidForRole(activeEmployeeCode, form.role)}
                >
                    {loading ? <Spinner size="sm" className="mr-2" /> : <HiCheck className="mr-2" />}
                    Tạo nhân viên
                </Button>
                <Button color="gray" onClick={handleClose} disabled={loading}>
                    Hủy
                </Button>
            </Modal.Footer>
        </Modal>
    );
}
