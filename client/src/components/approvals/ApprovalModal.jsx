import { Modal, Button, Alert, Spinner, Textarea } from 'flowbite-react';

/**
 * Confirmation modal for approve/reject actions.
 * Extracted from ApprovalsPage.jsx.
 * 
 * @param {Object} props
 * @param {boolean} props.show - Modal visibility
 * @param {Object} props.request - Selected request object
 * @param {string} props.action - 'approve' | 'reject'
 * @param {boolean} props.loading - During action
 * @param {string} props.error - Error message
 * @param {string} props.rejectReason - Reject reason text (optional)
 * @param {Function} props.onRejectReasonChange - (value: string) => void
 * @param {Function} props.onConfirm - () => void
 * @param {Function} props.onClose - () => void
 */
export default function ApprovalModal({
    show,
    request,
    action,
    loading,
    error,
    rejectReason,
    onRejectReasonChange,
    onConfirm,
    onClose
}) {
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
        return date.toLocaleDateString('vi-VN', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
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

    const formatOtPreviewDuration = (preview) => {
        const minutes = Number(preview?.minutes || 0);
        if (!Number.isFinite(minutes) || minutes <= 0) return null;
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        return `${hours}h ${mins}m`;
    };

    const getLeaveTypeLabel = (type) => {
        const labels = {
            ANNUAL: 'Phép năm',
            SICK: 'Ốm đau',
            UNPAID: 'Không lương',
        };
        return labels[type] || 'Nghỉ phép';
    };

    const isApprove = action === 'approve';
    const actionLabel = isApprove ? 'duyệt' : 'từ chối';
    const requestDate = request?.date || request?.checkInDate;
    const otDuration = formatOtPreviewDuration(request?.otPreview);

    return (
        <Modal show={show} onClose={loading ? () => {} : onClose} size="md">
            <Modal.Header>
                Xác nhận {actionLabel}
            </Modal.Header>
            <Modal.Body>
                {error && (
                    <Alert color="failure" className="mb-4">
                        {error}
                    </Alert>
                )}

                <div className="space-y-3">
                    <p>
                        Bạn có chắc chắn muốn{' '}
                        <strong>{actionLabel}</strong>{' '}
                        yêu cầu của <strong>{request?.userId?.name}</strong>?
                    </p>

                    <div className="bg-gray-50 p-3 rounded text-sm space-y-1">
                        {request?.type === 'OT_REQUEST' ? (
                            <>
                                <p><span className="text-gray-500">Ngày:</span> {formatDate(requestDate)}</p>
                                <p>
                                    <span className="text-gray-500">Loại OT:</span>{' '}
                                    {request?.otMode === 'SEPARATED' ? 'Phiên tách rời' : 'Liên tục'}
                                </p>
                                {request?.otMode === 'SEPARATED' && (
                                    <p>
                                        <span className="text-gray-500">Bắt đầu OT:</span>{' '}
                                        {formatOtEndTime(request?.otPreview?.startTime || request?.otStartTime, requestDate)}
                                    </p>
                                )}
                                <p>
                                    <span className="text-gray-500">Dự kiến về:</span>{' '}
                                    {formatOtEndTime(request?.estimatedEndTime, requestDate)}
                                </p>
                                {otDuration && (
                                    <p>
                                        <span className="text-gray-500">Thời lượng OT dự kiến:</span>{' '}
                                        <span className="font-medium text-purple-700">{otDuration}</span>
                                    </p>
                                )}
                                <p>
                                    <span className="text-gray-500">Check-in thực tế:</span>{' '}
                                    {request?.attendance?.checkInAt
                                        ? formatTime(request.attendance.checkInAt)
                                        : 'Chưa check-in'}
                                </p>
                                <p>
                                    <span className="text-gray-500">Check-out thực tế:</span>{' '}
                                    {request?.attendance?.checkOutAt
                                        ? formatTime(request.attendance.checkOutAt)
                                        : 'Chưa check-out'}
                                </p>
                                <p><span className="text-gray-500">Lý do:</span> {request?.reason}</p>
                            </>
                        ) : request?.type === 'ADJUST_TIME' ? (
                            <>
                                <p><span className="text-gray-500">Ngày:</span> {formatDate(requestDate)}</p>
                                <p><span className="text-gray-500">Check-in:</span> {formatTime(request?.requestedCheckInAt)}</p>
                                <p><span className="text-gray-500">Check-out:</span> {formatTime(request?.requestedCheckOutAt)}</p>
                                <p><span className="text-gray-500">Lý do:</span> {request?.reason}</p>
                            </>
                        ) : request?.type === 'LEAVE' ? (
                            <>
                                <p>
                                    <span className="text-gray-500">Khoảng nghỉ:</span>{' '}
                                    {formatDate(request?.leaveStartDate)} → {formatDate(request?.leaveEndDate)}
                                </p>
                                <p>
                                    <span className="text-gray-500">Loại nghỉ:</span>{' '}
                                    {getLeaveTypeLabel(request?.leaveType)}
                                </p>
                                {typeof request?.leaveDaysCount === 'number' && (
                                    <p>
                                        <span className="text-gray-500">Số ngày làm việc:</span>{' '}
                                        {request.leaveDaysCount} ngày
                                    </p>
                                )}
                                <p><span className="text-gray-500">Lý do:</span> {request?.reason}</p>
                            </>
                        ) : (
                            <>
                                <p><span className="text-gray-500">Ngày:</span> {formatDate(requestDate || request?.leaveStartDate)}</p>
                                <p><span className="text-gray-500">Lý do:</span> {request?.reason}</p>
                            </>
                        )}
                    </div>

                    {!isApprove && (
                        <div className="space-y-2">
                            <label htmlFor="reject-reason" className="block text-sm font-medium text-gray-700">
                                Lý do từ chối (tùy chọn)
                            </label>
                            <Textarea
                                id="reject-reason"
                                rows={3}
                                value={rejectReason ?? ''}
                                onChange={(event) => onRejectReasonChange?.(event.target.value)}
                                placeholder="Nhập lý do từ chối..."
                                disabled={loading}
                                maxLength={500}
                            />
                        </div>
                    )}
                </div>
            </Modal.Body>
            <Modal.Footer>
                <Button
                    color={isApprove ? 'success' : 'failure'}
                    onClick={onConfirm}
                    disabled={loading}
                >
                    {loading ? <Spinner size="sm" className="mr-2" /> : null}
                    Xác nhận
                </Button>
                <Button color="gray" onClick={onClose} disabled={loading}>
                    Hủy
                </Button>
            </Modal.Footer>
        </Modal>
    );
}
