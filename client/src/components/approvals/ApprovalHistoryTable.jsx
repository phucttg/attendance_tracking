import { Table, Badge, Pagination, Select } from 'flowbite-react';
import { getOtRequestDateMeta } from '../../utils/dateDisplay';

/**
 * Table displaying approval/rejection history for manager/admin.
 *
 * @param {Object} props
 * @param {Array} props.requests - History request items
 * @param {Object} props.pagination - { page, limit, total, totalPages }
 * @param {Function} props.onPageChange - (page: number) => void
 * @param {string} props.statusFilter - '' | 'APPROVED' | 'REJECTED'
 * @param {Function} props.onStatusFilterChange - (status: string) => void
 */
export default function ApprovalHistoryTable({
    requests,
    pagination,
    onPageChange,
    statusFilter,
    onStatusFilterChange
}) {
    const safeRequests = (requests || []).filter((request) => request?._id);
    const isEmpty = safeRequests.length === 0;

    const safePagination = {
        page: pagination?.page ?? 1,
        totalPages: pagination?.totalPages ?? 0
    };

    const currentPage = Math.min(
        Math.max(1, safePagination.page || 1),
        safePagination.totalPages || 1
    );

    const formatDate = (dateStr) => {
        if (!dateStr) return 'N/A';
        const date = new Date(`${dateStr}T00:00:00+07:00`);
        if (isNaN(date.getTime())) return 'N/A';
        return date.toLocaleDateString('vi-VN', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        });
    };

    const formatDateTime = (isoString) => {
        if (!isoString) return 'N/A';
        const date = new Date(isoString);
        if (isNaN(date.getTime())) return 'N/A';
        return date.toLocaleString('vi-VN', {
            timeZone: 'Asia/Ho_Chi_Minh',
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
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

    const getStatusBadge = (status) => {
        if (status === 'APPROVED') {
            return <Badge color="success">Đã duyệt</Badge>;
        }
        if (status === 'REJECTED') {
            return <Badge color="failure">Từ chối</Badge>;
        }
        return <Badge color="gray">{status || 'N/A'}</Badge>;
    };

    const getDateDisplay = (request) => {
        if (request.type === 'LEAVE') {
            return `${formatDate(request.leaveStartDate)} → ${formatDate(request.leaveEndDate)}`;
        }

        if (request.type !== 'OT_REQUEST') {
            return formatDate(request.date || request.checkInDate);
        }

        const { actualDate, anchorDate, isSeparatedCarryOver } = getOtRequestDateMeta(request);
        if (!isSeparatedCarryOver) {
            return formatDate(anchorDate);
        }

        return (
            <div className="flex flex-col gap-1">
                <span>{formatDate(actualDate)}</span>
                <span className="text-xs text-gray-500">Neo ca: {formatDate(anchorDate)}</span>
            </div>
        );
    };

    const getRejectReasonDisplay = (request) =>
        request.rejectReason || request.systemRejectReason || '—';

    return (
        <div className="space-y-4">
            <div className="max-w-xs">
                <label htmlFor="history-status-filter" className="block text-sm font-medium text-gray-700 mb-1">
                    Trạng thái
                </label>
                <Select
                    id="history-status-filter"
                    value={statusFilter ?? ''}
                    onChange={(event) => onStatusFilterChange?.(event.target.value)}
                >
                    <option value="">Tất cả</option>
                    <option value="APPROVED">Đã duyệt</option>
                    <option value="REJECTED">Từ chối</option>
                </Select>
            </div>

            <div className="overflow-x-auto">
                <Table striped>
                    <Table.Head>
                        <Table.HeadCell>Nhân viên</Table.HeadCell>
                        <Table.HeadCell>Loại</Table.HeadCell>
                        <Table.HeadCell>Ngày</Table.HeadCell>
                        <Table.HeadCell>Trạng thái</Table.HeadCell>
                        <Table.HeadCell>Người xử lý</Table.HeadCell>
                        <Table.HeadCell>Lúc xử lý</Table.HeadCell>
                        <Table.HeadCell>Lý do từ chối</Table.HeadCell>
                    </Table.Head>
                    <Table.Body className="divide-y">
                        {isEmpty ? (
                            <Table.Row>
                                <Table.Cell colSpan={7} className="text-center py-8 text-gray-500">
                                    Chưa có lịch sử duyệt yêu cầu
                                </Table.Cell>
                            </Table.Row>
                        ) : (
                            safeRequests.map((request) => (
                                <Table.Row key={request._id} className="bg-white">
                                    <Table.Cell className="font-medium">
                                        <div>{request.userId?.name || 'N/A'}</div>
                                        <div className="text-xs text-gray-500">
                                            {request.userId?.employeeCode || '—'}
                                        </div>
                                    </Table.Cell>
                                    <Table.Cell>{getTypeBadge(request.type)}</Table.Cell>
                                    <Table.Cell className="whitespace-nowrap">{getDateDisplay(request)}</Table.Cell>
                                    <Table.Cell>{getStatusBadge(request.status)}</Table.Cell>
                                    <Table.Cell>
                                        <div>{request.approvedBy?.name || 'N/A'}</div>
                                        <div className="text-xs text-gray-500">
                                            {request.approvedBy?.employeeCode || '—'}
                                        </div>
                                    </Table.Cell>
                                    <Table.Cell className="whitespace-nowrap text-sm text-gray-500">
                                        {formatDateTime(request.approvedAt)}
                                    </Table.Cell>
                                    <Table.Cell className="max-w-xs truncate" title={getRejectReasonDisplay(request)}>
                                        {getRejectReasonDisplay(request)}
                                    </Table.Cell>
                                </Table.Row>
                            ))
                        )}
                    </Table.Body>
                </Table>
            </div>

            {safePagination.totalPages > 1 && (
                <div className="mt-4 flex flex-col items-center gap-2">
                    <div className="text-sm text-gray-600">
                        Trang {currentPage} / {safePagination.totalPages}
                    </div>
                    <Pagination
                        currentPage={currentPage}
                        totalPages={safePagination.totalPages}
                        onPageChange={(page) => onPageChange?.(page)}
                        showIcons
                    />
                </div>
            )}
        </div>
    );
}
