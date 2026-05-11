import { useState, useEffect } from 'react';
import { Card, Badge, Spinner } from 'flowbite-react';
import { useAuth } from '../context/AuthContext';
import { getTeams } from '../api/memberApi';

/**
 * ProfilePage: Display current user's profile information.
 * 
 * Features:
 * - Shows user info from AuthContext (fetched via /auth/me)
 * - Fetches team name via /api/teams and maps teamId
 * - Read-only display (per MVP scope)
 * 
 * Fields: name, email, username, employeeCode, role, teamId, startDate
 */
export default function ProfilePage() {
    const { user } = useAuth();

    // Combined state: { forTeamId, name } - auto-invalidates when teamId changes
    // forTeamId tracks which teamId this name belongs to
    const [teamData, setTeamData] = useState({ forTeamId: null, name: null });

    // Derived loading state: loading when teamData doesn't match current teamId
    const currentTeamId = user?.teamId;
    const isLoadingTeam = Boolean(currentTeamId) && teamData.forTeamId !== currentTeamId;
    const teamName = teamData.forTeamId === currentTeamId ? teamData.name : null;

    // Fetch team name if user has teamId and data is stale
    useEffect(() => {
        if (!currentTeamId) return;
        // Skip if already fetched for this teamId
        if (teamData.forTeamId === currentTeamId) return;

        const controller = new AbortController();

        // P1-1 FIX: Pass signal to getTeams for proper request cancellation
        getTeams({ signal: controller.signal })
            .then((res) => {
                if (controller.signal.aborted) return;
                const teams = Array.isArray(res.data?.items) ? res.data.items : [];
                const team = teams.find((t) => t._id === currentTeamId);
                // P1-2 FIX: Store teamId with name to auto-invalidate on change
                setTeamData({ forTeamId: currentTeamId, name: team?.name || 'Unknown' });
            })
            .catch((err) => {
                if (err.name === 'CanceledError' || err.name === 'AbortError') return;
                setTeamData({ forTeamId: currentTeamId, name: 'Error loading' });
            });

        return () => controller.abort();
    }, [currentTeamId, teamData.forTeamId]);

    // Show spinner while user is loading (from AuthContext)
    if (!user) {
        return (
            <div className="flex justify-center py-8">
                <Spinner size="lg" />
            </div>
        );
    }

    // Format date helper (GMT+7)
    const formatDate = (dateStr) => {
        if (!dateStr) return '-';
        return new Date(dateStr).toLocaleDateString('vi-VN', {
            timeZone: 'Asia/Ho_Chi_Minh',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
        });
    };

    // Role badge color mapping
    const roleBadgeColor = {
        ADMIN: 'failure',
        MANAGER: 'warning',
        EMPLOYEE: 'info',
    };

    return (
        <div className="max-w-2xl mx-auto">
            {/* Page Title */}
            <h1 className="text-2xl font-bold text-gray-900 mb-6">Hồ sơ cá nhân</h1>

            <Card>
                {/* Avatar + Name Header */}
                <div className="flex items-center gap-4 mb-6">
                    <div className="w-16 h-16 rounded-full bg-primary-100 flex items-center justify-center">
                        <span className="text-2xl font-bold text-primary-600">
                            {user.name?.charAt(0).toUpperCase()}
                        </span>
                    </div>
                    <div>
                        <h2 className="text-xl font-semibold text-gray-900">{user.name}</h2>
                        <Badge color={roleBadgeColor[user.role] || 'gray'}>
                            {user.role}
                        </Badge>
                    </div>
                </div>

                {/* Profile Fields Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                    <ProfileField label="Mã nhân viên" value={user.employeeCode} />
                    <ProfileField label="Email" value={user.email || '-'} />
                    <ProfileField label="Username" value={user.username || '-'} />
                    <ProfileField
                        label="Team"
                        value={isLoadingTeam ? 'Đang tải...' : (teamName || '-')}
                    />
                    <ProfileField label="Ngày bắt đầu" value={formatDate(user.startDate)} />
                </div>
            </Card>
        </div>
    );
}

/**
 * ProfileField: Reusable component for displaying a label-value pair.
 */
function ProfileField({ label, value }) {
    return (
        <div>
            <p className="text-gray-500">{label}</p>
            <p className="font-medium text-gray-900">{value}</p>
        </div>
    );
}
