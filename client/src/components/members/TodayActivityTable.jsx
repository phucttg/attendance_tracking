import { Table, Button, Pagination } from 'flowbite-react';
import { HiEye, HiPencil, HiKey } from 'react-icons/hi';
import { ScheduleBadge, StatusBadge } from '../ui';
import { formatTime } from '../../utils/dateTimeFormat';

/**
 * Table displaying today's attendance activity for members.
 * Extracted from AdminMembersPage.jsx lines 449-498.
 * 
 * Features:
 * - Displays member info (code, name, email)
 * - Shows attendance status with StatusBadge
 * - Displays check-in/out times
 * - Action buttons: View Detail, Edit, Reset Password
 * - Pagination controls (v2.5+)
 * - Responsive overflow handling
 * - Empty state when no data
 * - Accessibility (aria-labels)
 * - Safe data access (guards against null/undefined)
 *
 * @param {Object} props
 * @param {Array} props.members - List of { user, attendance, computed }
 * @param {Object} [props.pagination] - { page, totalPages } (v2.5+)
 * @param {Function} [props.onPageChange] - (page: number) => void (v2.5+)
 * @param {Function} props.onViewDetail - (userId: string) => void
 * @param {Function} props.onEdit - (user: Object) => void
 * @param {Function} props.onResetPassword - (user: Object) => void
 */
export default function TodayActivityTable({
    members,
    pagination,
    onPageChange,
    onViewDetail,
    onEdit,
    onResetPassword
}) {
    // Filter valid members upfront to avoid sparse array with nulls
    const validMembers = (members || []).filter(item => item?.user?._id);
    const isEmpty = validMembers.length === 0;
    const safePagination = pagination || { page: 1, totalPages: 0 };

    // P2 FIX: Clamp currentPage to valid range
    const currentPage = Math.min(
        Math.max(1, safePagination.page || 1),
        safePagination.totalPages || 1
    );

    return (
        <>
        <div className="overflow-x-auto">
            <Table striped>
                <Table.Head>
                    <Table.HeadCell>Code</Table.HeadCell>
                    <Table.HeadCell>Name</Table.HeadCell>
                    <Table.HeadCell>Email</Table.HeadCell>
                    <Table.HeadCell>Status</Table.HeadCell>
                    <Table.HeadCell>Ca</Table.HeadCell>
                    <Table.HeadCell>Check In</Table.HeadCell>
                    <Table.HeadCell>Check Out</Table.HeadCell>
                    <Table.HeadCell>Actions</Table.HeadCell>
                </Table.Head>
                <Table.Body className="divide-y">
                    {/* P2 FIX: Empty state */}
                    {isEmpty ? (
                            <Table.Row>
                                <Table.Cell colSpan={8} className="text-center py-8 text-gray-500">
                                    No activity found for today.
                                </Table.Cell>
                            </Table.Row>
                    ) : (
                        validMembers.map((item) => {
                            const user = item.user;

                            return (
                                <Table.Row key={user._id} className="bg-white">
                                    {/* P3 FIX: whitespace-nowrap for code */}
                                    <Table.Cell className="whitespace-nowrap font-medium text-gray-900">
                                        {user.employeeCode || '—'}
                                    </Table.Cell>
                                    <Table.Cell>{user.name || '—'}</Table.Cell>
                                    {/* P3 FIX: max-width + truncate for long emails */}
                                    <Table.Cell className="text-gray-500 text-sm max-w-[200px] truncate">
                                        {user.email || '—'}
                                    </Table.Cell>
                                    <Table.Cell>
                                        <StatusBadge status={item.computed?.status} />
                                    </Table.Cell>
                                    <Table.Cell>
                                        <ScheduleBadge scheduleType={item.scheduleType} />
                                    </Table.Cell>
                                    {/* P3 FIX: whitespace-nowrap for times */}
                                    <Table.Cell className="whitespace-nowrap">
                                        {formatTime(item.attendance?.checkInAt)}
                                    </Table.Cell>
                                    <Table.Cell className="whitespace-nowrap">
                                        {formatTime(item.attendance?.checkOutAt)}
                                    </Table.Cell>
                                    <Table.Cell>
                                        <div className="flex gap-2">
                                            {/* P1 FIX: Optional chaining for callbacks */}
                                            {/* P2 FIX: aria-label for accessibility */}
                                            <Button
                                                size="xs"
                                                color="light"
                                                onClick={() => onViewDetail?.(user._id)}
                                                title="View Detail"
                                                aria-label="View member detail"
                                            >
                                                <HiEye className="h-4 w-4" />
                                            </Button>
                                            <Button
                                                size="xs"
                                                color="light"
                                                onClick={() => onEdit?.(user)}
                                                title="Edit Member"
                                                aria-label="Edit member"
                                            >
                                                <HiPencil className="h-4 w-4" />
                                            </Button>
                                            <Button
                                                size="xs"
                                                color="light"
                                                onClick={() => onResetPassword?.(user)}
                                                title="Reset Password"
                                                aria-label="Reset member password"
                                            >
                                                <HiKey className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </Table.Cell>
                                </Table.Row>
                            );
                        })
                    )}
                </Table.Body>
            </Table>
        </div>

        {/* Pagination Controls - only show if more than 1 page */}
        {safePagination.totalPages > 1 && (
            <div className="mt-4 flex flex-col items-center gap-2">
                {/* Page indicator text */}
                <div className="text-sm text-gray-600 dark:text-gray-400">
                    Trang {currentPage} / {safePagination.totalPages}
                </div>
                
                {/* Pagination buttons */}
                <Pagination
                    currentPage={currentPage}
                    totalPages={safePagination.totalPages}
                    onPageChange={(p) => onPageChange?.(p)}
                    showIcons
                />
            </div>
        )}
        </>
    );
}
