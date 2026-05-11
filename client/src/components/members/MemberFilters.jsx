import { useEffect } from 'react';
import { Label, Select } from 'flowbite-react';

/**
 * Scope and team filters for Today Activity view.
 * Extracted from AdminMembersPage.jsx lines 343-388.
 * 
 * Features:
 * - Scope selector (company/team)
 * - Team dropdown (conditional, only when scope='team')
 * - Auto-clear teamId when team is removed from list
 * - Mobile responsive layout
 * - Distinguishes between loading (null) and empty ([]) teams
 * - Shows error message when teams fail to load (v2.5+)
 * 
 * @param {Object} props
 * @param {'company' | 'team'} props.scope - Current scope
 * @param {Function} props.onScopeChange - (scope: string) => void
 * @param {string} props.teamId - Current team ID
 * @param {Function} props.onTeamChange - (teamId: string) => void
 * @param {Array|null} props.teams - List of teams [{ _id, name }], null when loading
 * @param {boolean} [props.teamsFetchError=false] - Whether teams fetch failed (v2.5+)
 * @param {string} props.todayDate - Today's date for display
 */
export default function MemberFilters({
    scope,
    onScopeChange,
    teamId,
    onTeamChange,
    teams,
    teamsFetchError = false,
    todayDate
}) {
    // ═══════════════════════════════════════════════════════════════════════
    // Auto-clear teamId if it's no longer in the teams list
    // This handles edge cases:
    // - Team deleted by admin
    // - User loses access to team
    // - All teams removed (teams = [])
    // ═══════════════════════════════════════════════════════════════════════

    useEffect(() => {
        // Early return if:
        // - Scope is not 'team' (teamId not relevant)
        // - No teamId selected (nothing to validate)
        // - Teams not loaded yet (null/undefined)
        if (scope !== 'team' || !teamId || !Array.isArray(teams)) return;

        // Check if current teamId still exists in teams list
        const exists = teams.some(t => t._id === teamId);

        // Clear teamId if it no longer exists (including when teams = [])
        if (!exists) {
            onTeamChange('');
        }
        // Note: onTeamChange excluded from deps intentionally
        // We only want to re-run when DATA changes (scope/teamId/teams)
        // not when callback identity changes
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [scope, teamId, teams]);

    const handleScopeChange = (e) => {
        const newScope = e.target.value;
        onScopeChange(newScope);
        // Clear team when switching to 'company'
        if (newScope === 'company') {
            onTeamChange('');
        }
    };

    // Distinguish between loading and empty states
    // Note: For this to work optimally, parent should initialize teams as null
    // and set to [] after fetch completes (even if empty)
    const teamsLoading = teams == null;  // null or undefined = loading
    const teamsEmpty = Array.isArray(teams) && teams.length === 0;

    return (
        // flex-wrap for mobile responsiveness, items-end for alignment
        <div className="flex flex-wrap gap-4 mb-4 items-end">
            {/* Scope Select */}
            <div className="w-full sm:w-auto">
                <Label htmlFor="scope" value="Phạm vi" className="mb-1 block" />
                <Select
                    id="scope"
                    value={scope}
                    onChange={handleScopeChange}
                >
                    <option value="company">Toàn công ty</option>
                    <option value="team">Theo nhóm</option>
                </Select>
            </div>

            {/* Team Select (conditional) */}
            {scope === 'team' && (
                <div className="w-full sm:w-auto">
                    <Label htmlFor="teamId" value="Team" className="mb-1 block" />
                    <Select
                        id="teamId"
                        value={teamId || ''}
                        onChange={(e) => onTeamChange(e.target.value)}
                        disabled={teamsLoading}
                    >
                        <option value="">
                            {teamsLoading
                                ? 'Đang tải nhóm...'
                                : teamsFetchError
                                ? 'Không thể tải danh sách nhóm'
                                : teamsEmpty
                                ? 'Chưa có nhóm nào'
                                : 'Chọn nhóm...'}
                        </option>
                        {(teams || []).map((team) => (
                            <option key={team._id} value={team._id}>
                                {team.name}
                            </option>
                        ))}
                    </Select>
                </div>
            )}

            {/* Today Date Display */}
            {todayDate && (
                <div className="text-sm text-gray-500 sm:ml-auto pb-2 w-full sm:w-auto text-left">
                    Hôm nay: {todayDate}
                </div>
            )}
        </div>
    );
}
