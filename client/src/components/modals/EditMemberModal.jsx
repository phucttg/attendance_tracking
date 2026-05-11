import { useState, useEffect } from 'react';
import { Modal, Button, Label, TextInput, Select, Alert, Spinner } from 'flowbite-react';
import { HiCheck } from 'react-icons/hi';
import { MAX_LENGTHS } from '../../utils/validation';

/**
 * EditMemberModal: Shared modal for editing member profile.
 * Extracted from AdminMembersPage.jsx and AdminMemberDetailPage.jsx.
 * 
 * Features:
 * - Whitelist fields: name, email, username, teamId, isActive, startDate
 * - Only sends changed fields to backend (optimistic update)
 * - Auto-syncs form when user prop changes
 * - Internal loading/error state management
 * 
 * Props:
 *  - show: boolean - modal visibility
 *  - user: object|null - user being edited (triggers form sync)
 *  - teams: array - team options for dropdown
 *  - onClose: () => void - callback when modal closes
 *  - onSubmit: (changedData, userId) => Promise<void> - async submit handler
 *    - changedData: object with only modified fields
 *    - userId: string - user._id for API call
 * 
 * Usage:
 * ```jsx
 * const handleEditSubmit = async (data, userId) => {
 *   await updateUser(userId, data);
 *   showToast('Updated!');
 *   fetchMembers();
 * };
 * 
 * <EditMemberModal
 *   show={!!editUser}
 *   user={editUser}
 *   teams={teams}
 *   onClose={() => setEditUser(null)}
 *   onSubmit={handleEditSubmit}
 * />
 * ```
 */
export default function EditMemberModal({ show, user, teams, onClose, onSubmit }) {
    const [form, setForm] = useState({
        name: '',
        email: '',
        username: '',
        teamId: '',
        isActive: true,
        startDate: ''
    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    // Sync form when user changes
    useEffect(() => {
        if (user) {
            setForm({
                name: user.name || '',
                email: user.email || '',
                username: user.username || '',
                teamId: user.teamId || '',
                isActive: user.isActive ?? true,
                startDate: user.startDate ? user.startDate.split('T')[0] : ''
            });
            setError('');
        }
    }, [user]);

    const handleSubmit = async () => {
        if (!user) return;

        setLoading(true);
        setError('');

        try {
            // Only send changed fields (whitelist pattern per RULES.md)
            const data = {};
            
            // Trim name/email before compare (consistency with Create form per RULES.md 5.2C)
            const trimmedName = form.name.trim();
            const trimmedEmail = form.email.trim();
            if (trimmedName !== (user.name || '')) data.name = trimmedName;
            if (trimmedEmail !== (user.email || '')) data.email = trimmedEmail;
            
            // Only send username if changed and not empty (avoid conflict, trim for consistency)
            const trimmedUsername = form.username.trim();
            if (trimmedUsername !== (user.username || '') && trimmedUsername) {
                data.username = trimmedUsername;
            }
            
            // Only send teamId if changed and not empty (backend rejects '' as invalid ObjectId)
            const originalTeamId = user.teamId || '';
            if (form.teamId !== originalTeamId && form.teamId) {
                data.teamId = form.teamId;
            }
            
            // Fix: Prevent false positive when user.isActive is undefined
            const originalIsActive = user.isActive ?? true;
            if (form.isActive !== originalIsActive) data.isActive = form.isActive;
            
            if (form.startDate) {
                const originalDate = user.startDate ? user.startDate.split('T')[0] : '';
                if (form.startDate !== originalDate) data.startDate = form.startDate;
            }

            // If no changes, just close
            if (Object.keys(data).length === 0) {
                onClose();
                return;
            }

            // Call parent's submit handler with changed data + userId
            await onSubmit(data, user._id);
            
            // Success → parent will show toast, close modal
            onClose();
        } catch (err) {
            setError(err.response?.data?.message || err.message || 'Cập nhật thất bại');
        } finally {
            setLoading(false);
        }
    };

    return (
        <Modal show={show} onClose={onClose}>
            <Modal.Header>Chỉnh sửa: {user?.name}</Modal.Header>
            <Modal.Body>
                {error && (
                    <Alert color="failure" className="mb-4">{error}</Alert>
                )}
                <div className="space-y-4">
                    <div>
                        <Label htmlFor="edit-name" value="Họ tên" />
                        <TextInput
                            id="edit-name"
                            value={form.name || ''}
                            onChange={(e) => setForm({ ...form, name: e.target.value })}
                            maxLength={MAX_LENGTHS.name}
                        />
                    </div>
                    <div>
                        <Label htmlFor="edit-email" value="Email" />
                        <TextInput
                            id="edit-email"
                            type="email"
                            value={form.email || ''}
                            onChange={(e) => setForm({ ...form, email: e.target.value })}
                            maxLength={MAX_LENGTHS.email}
                        />
                    </div>
                    <div>
                        <Label htmlFor="edit-username" value="Tên đăng nhập" />
                        <TextInput
                            id="edit-username"
                            value={form.username || ''}
                            onChange={(e) => setForm({ ...form, username: e.target.value })}
                            maxLength={MAX_LENGTHS.username}
                        />
                    </div>
                    <div>
                        <Label htmlFor="edit-team" value="Nhóm" />
                        <Select
                            id="edit-team"
                            value={form.teamId || ''}
                            onChange={(e) => setForm({ ...form, teamId: e.target.value })}
                        >
                            <option value="">Không có nhóm</option>
                            {(teams || []).map((team) => (
                                <option key={team._id} value={team._id}>{team.name}</option>
                            ))}
                        </Select>
                    </div>
                    <div>
                        <Label htmlFor="edit-startDate" value="Ngày bắt đầu" />
                        <TextInput
                            id="edit-startDate"
                            type="date"
                            value={form.startDate || ''}
                            onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                        />
                    </div>
                    <div className="flex items-center gap-2">
                        <input
                            id="edit-isActive"
                            type="checkbox"
                            checked={form.isActive ?? true}
                            onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                            className="w-4 h-4 text-blue-600 rounded border-gray-300"
                        />
                        <Label htmlFor="edit-isActive" value="Đang hoạt động" />
                    </div>
                </div>
            </Modal.Body>
            <Modal.Footer>
                <Button onClick={handleSubmit} disabled={loading}>
                    {loading ? <Spinner size="sm" className="mr-2" /> : <HiCheck className="mr-2" />}
                    Lưu
                </Button>
                <Button color="gray" onClick={onClose} disabled={loading}>
                    Hủy
                </Button>
            </Modal.Footer>
        </Modal>
    );
}
