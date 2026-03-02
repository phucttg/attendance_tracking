import { Table, Button, Pagination, Badge } from 'flowbite-react';
import { HiCheck, HiX } from 'react-icons/hi';

/**
 * Table displaying pending requests for approval.
 * Extracted from ApprovalsPage.jsx.
 * 
 * @param {Object} props
 * @param {Array} props.requests - List of pending request objects
 * @param {Object} props.pagination - { page, limit, total, totalPages }
 * @param {Function} props.onPageChange - (page: number) => void
 * @param {Function} props.onApprove - (request: Object) => void
 * @param {Function} props.onReject - (request: Object) => void
 * @param {boolean} props.actionLoading - Disable buttons during action
 */
export default function PendingRequestsTable({
    requests,
    pagination,
    onPageChange,
    onApprove,
    onReject,
    actionLoading = false
}) {
    // Filter out invalid requests (defensive - backend always returns _id, but good practice)
    const safeRequests = (requests || []).filter(r => r?._id);
    const isEmpty = safeRequests.length === 0;
    
    // Normalize pagination fields to prevent undefined access
    const safePagination = {
        page: pagination?.page ?? 1,
        totalPages: pagination?.totalPages ?? 0,
    };

    // Clamp currentPage to valid range (prevent out-of-bounds from partial API response)
    const currentPage = Math.min(
        Math.max(1, safePagination.page || 1),
        safePagination.totalPages || 1
    );

    // Format helpers
    const formatTime = (isoString) => {
        if (!isoString) return '--:--';
        return new Date(isoString).toLocaleTimeString('vi-VN', {
            timeZone: 'Asia/Ho_Chi_Minh',
            hour: '2-digit',
            minute: '2-digit',
        });
    };

    const formatDate = (dateStr) => {
        if (!dateStr) return 'N/A';
        const date = new Date(dateStr + 'T00:00:00+07:00');
        // Guard against invalid dates (e.g., "2026-02-31")
        if (isNaN(date.getTime())) return 'N/A';
        return date.toLocaleDateString('vi-VN', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
        });
    };

    const formatDateTime = (isoString) => {
        if (!isoString) return 'N/A';
        const date = new Date(isoString);
        // Guard against invalid ISO strings
        if (isNaN(date.getTime())) return 'N/A';
        return date.toLocaleString('vi-VN', {
            timeZone: 'Asia/Ho_Chi_Minh',
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    };

    const getVnDateKey = (isoString) => {
        if (!isoString) return '';
        const date = new Date(isoString);
        if (isNaN(date.getTime())) return '';
        return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
    };

    const formatOtEndTime = (estimatedEndTime, requestDate) => {
        if (!estimatedEndTime) return '--:--';
        const time = formatTime(estimatedEndTime);
        const endDateKey = getVnDateKey(estimatedEndTime);
        if (!requestDate || !endDateKey || endDateKey === requestDate) return time;
        return `${time} (${formatDate(endDateKey)})`;
    };

    const getLeaveTypeLabel = (type) => {
        const labels = {
            ANNUAL: 'Phép năm',
            SICK: 'Ốm đau',
            UNPAID: 'Không lương',
        };
        return labels[type] || 'Nghỉ phép';
    };

    const getTypeBadge = (type) => {
        if (type === 'LEAVE') {
            return <Badge color="cyan">Nghỉ phép</Badge>;
        }
        if (type === 'OT_REQUEST') {
            return <Badge color="purple">Đăng ký OT</Badge>;
        }
        return <Badge color="indigo">Điều chỉnh</Badge>;
    };

    return (
        <>
            <div className="overflow-x-auto">
                <Table striped>
                    <Table.Head>
                        <Table.HeadCell>Nhân viên</Table.HeadCell>
                        <Table.HeadCell>Loại</Table.HeadCell>
                        <Table.HeadCell>Ngày / Khoảng</Table.HeadCell>
                        <Table.HeadCell>Chi tiết</Table.HeadCell>
                        <Table.HeadCell>Lý do</Table.HeadCell>
                        <Table.HeadCell>Tạo lúc</Table.HeadCell>
                        <Table.HeadCell>Thao tác</Table.HeadCell>
                    </Table.Head>
                    <Table.Body className="divide-y">
                        {isEmpty ? (
                            <Table.Row>
                                <Table.Cell colSpan={7} className="text-center py-8 text-gray-500">
                                    Không có yêu cầu nào đang chờ duyệt
                                </Table.Cell>
                            </Table.Row>
                        ) : (
                            safeRequests.map((req) => (
                                <Table.Row key={req._id} className="bg-white">
                                    {/* Employee Info */}
                                    <Table.Cell className="font-medium">
                                        <div>{req.userId?.name || 'N/A'}</div>
                                        <div className="text-xs text-gray-500">
                                            {req.userId?.employeeCode || '—'}
                                        </div>
                                    </Table.Cell>

                                    {/* Type Badge */}
                                    <Table.Cell>
                                        {getTypeBadge(req.type)}
                                    </Table.Cell>

                                    {/* Date / Range */}
                                    <Table.Cell className="whitespace-nowrap">
                                        {req.type === 'LEAVE' ? (
                                            <span>
                                                {formatDate(req.leaveStartDate)} → {formatDate(req.leaveEndDate)}
                                            </span>
                                        ) : (
                                            formatDate(req.date)
                                        )}
                                    </Table.Cell>

                                    {/* Details (Time or Leave Info or OT Info) */}
                                    <Table.Cell className="whitespace-nowrap">
                                        {req.type === 'LEAVE' ? (
                                            <div className="flex flex-col gap-1">
                                                <Badge color="blue" size="sm">
                                                    {getLeaveTypeLabel(req.leaveType)}
                                                </Badge>
                                                <span className="text-xs text-gray-600">
                                                    {req.leaveDaysCount ?? 0} ngày làm việc
                                                </span>
                                            </div>
                                        ) : req.type === 'OT_REQUEST' ? (
                                            <div className="space-y-2">
                                                <div className="text-sm space-y-1">
                                                    <div>
                                                        <span className="text-gray-600">Nhân viên:</span>
                                                        <span className="ml-2 font-medium">{req.userId?.name || 'N/A'}</span>
                                                    </div>
                                                    <div>
                                                        <span className="text-gray-600">Ngày:</span>
                                                        <span className="ml-2 font-medium">{formatDate(req.date)}</span>
                                                    </div>
                                                    <div>
                                                        <span className="text-gray-600">Dự kiến về:</span>
                                                        <span className="ml-2 font-medium">
                                                            {formatOtEndTime(req.estimatedEndTime, req.date)}
                                                        </span>
                                                    </div>
                                                    {(() => {
                                                        try {
                                                            const otStart = new Date(`${req.date}T17:31:00+07:00`);
                                                            const otEnd = new Date(req.estimatedEndTime);
                                                            const diffMinutes = Math.floor((otEnd - otStart) / 60000);
                                                            if (diffMinutes > 0) {
                                                                const hours = Math.floor(diffMinutes / 60);
                                                                const minutes = diffMinutes % 60;
                                                                return (
                                                                    <div>
                                                                        <span className="text-gray-600">Thời lượng dự kiến:</span>
                                                                        <span className="ml-2 font-bold text-purple-600">
                                                                            {hours}h {minutes}m
                                                                        </span>
                                                                    </div>
                                                                );
                                                            }
                                                        } catch (err) {
                                                            console.warn('Failed to calculate OT duration:', err);
                                                        }
                                                        return null;
                                                    })()}
                                                </div>
                                                <div className="text-xs text-purple-700 bg-purple-50 p-2 rounded border border-purple-200">
                                                    <strong>Lưu ý quản lý:</strong> Nhân viên cần approval trước checkout để được tính OT
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="flex flex-col gap-1">
                                                <span className="text-sm">
                                                    Vào: {formatTime(req.requestedCheckInAt)}
                                                </span>
                                                <span className="text-sm">
                                                    Ra: {formatTime(req.requestedCheckOutAt)}
                                                </span>
                                            </div>
                                        )}
                                    </Table.Cell>

                                    {/* Reason */}
                                    <Table.Cell className="max-w-xs truncate" title={req.reason}>
                                        {req.reason || '—'}
                                    </Table.Cell>

                                    {/* Created At */}
                                    <Table.Cell className="text-sm text-gray-500 whitespace-nowrap">
                                        {formatDateTime(req.createdAt)}
                                    </Table.Cell>

                                    {/* Actions */}
                                    <Table.Cell>
                                        <div className="flex gap-2">
                                            <Button
                                                size="xs"
                                                color="success"
                                                onClick={() => onApprove?.(req)}
                                                disabled={actionLoading}
                                                aria-label="Approve request"
                                            >
                                                <HiCheck className="mr-1" />
                                                Duyệt
                                            </Button>
                                            <Button
                                                size="xs"
                                                color="failure"
                                                onClick={() => onReject?.(req)}
                                                disabled={actionLoading}
                                                aria-label="Reject request"
                                            >
                                                <HiX className="mr-1" />
                                                Từ chối
                                            </Button>
                                        </div>
                                    </Table.Cell>
                                </Table.Row>
                            ))
                        )}
                    </Table.Body>
                </Table>
            </div>

            {/* Pagination - at bottom */}
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
