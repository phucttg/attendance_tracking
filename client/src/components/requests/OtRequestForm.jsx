import { useEffect, useState } from 'react';
import {
    Label,
    TextInput,
    Textarea,
    Button,
    Spinner,
    Alert,
    Modal,
    Select,
} from 'flowbite-react';
import { HiPlus } from 'react-icons/hi';
import { createRequest } from '../../api/requestApi';
import { getMyAttendance, getMyWorkSchedules } from '../../api/memberApi';
import {
    addDaysToDate,
    buildIsoTimestamp,
    getNextDayDisplay,
} from '../../utils/dateDisplay';

const OT_CROSS_MIDNIGHT_CUTOFF = '08:00';
const OT_MODE_CONTINUOUS = 'CONTINUOUS';
const OT_MODE_SEPARATED = 'SEPARATED';
const FIXED_SHIFT_OT_POLICIES = {
    SHIFT_1: {
        label: 'Ca 1',
        threshold: '17:30',
        earliestEnd: '18:00',
    },
    SHIFT_2: {
        label: 'Ca 2',
        threshold: '18:30',
        earliestEnd: '19:00',
    },
};

const isCrossMidnightOt = (timeValue) =>
    Boolean(timeValue) && timeValue < OT_CROSS_MIDNIGHT_CUTOFF;

const getFixedShiftPolicy = (scheduleType) => FIXED_SHIFT_OT_POLICIES[scheduleType] ?? null;
const normalizeScheduleType = (value) =>
    typeof value === 'string' ? value.trim().toUpperCase() : '';
const isFlexibleScheduleType = (value) => normalizeScheduleType(value) === 'FLEXIBLE';
const getMonthStartDate = (dateStr) =>
    dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? `${dateStr.slice(0, 7)}-01` : '';

const resolveOtDate = (date, timeValue, keepEarlyTimeOnSelectedDate = false) => {
    if (!date || !timeValue) return null;
    if (keepEarlyTimeOnSelectedDate) return date;
    if (!isCrossMidnightOt(timeValue)) return date;
    return addDaysToDate(date, 1);
};

const parseVnDateTime = (date, timeValue) => {
    if (!date || !timeValue) return null;
    const parsed = new Date(`${date}T${timeValue}:00+07:00`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const formatMinutes = (minutes) => {
    if (!Number.isFinite(minutes) || minutes <= 0) return '0 phút';
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours <= 0) return `${mins} phút`;
    return `${hours} giờ ${mins} phút`;
};

const getCurrentTimeKeyInVn = () =>
    new Date().toLocaleTimeString('en-GB', {
        timeZone: 'Asia/Ho_Chi_Minh',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    });

const formatDisplayDate = (dateStr) => {
    if (!dateStr) return '';
    const parsed = new Date(`${dateStr}T00:00:00+07:00`);
    if (isNaN(parsed.getTime())) return '';
    return parsed.toLocaleDateString('vi-VN');
};

const formatTimeKeyInVn = (dateLike) => {
    if (!dateLike) return '';
    const parsed = dateLike instanceof Date ? dateLike : new Date(dateLike);
    if (Number.isNaN(parsed.getTime())) return '';
    return parsed.toLocaleTimeString('en-GB', {
        timeZone: 'Asia/Ho_Chi_Minh',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    });
};

const formatDateKeyInVn = (dateLike) => {
    if (!dateLike) return '';
    const parsed = dateLike instanceof Date ? dateLike : new Date(dateLike);
    if (Number.isNaN(parsed.getTime())) return '';
    return parsed.toLocaleDateString('sv-SE', {
        timeZone: 'Asia/Ho_Chi_Minh',
    });
};

/**
 * Form for creating OT_REQUEST requests, including confirm modal flow.
 */
export default function OtRequestForm({
    formData,
    onFieldChange,
    onSuccess,
    setFormError,
    setFormSuccess,
}) {
    const today = new Date().toLocaleDateString('sv-SE', {
        timeZone: 'Asia/Ho_Chi_Minh',
    });
    const tomorrow = addDaysToDate(today, 1);
    const currentMonthStart = getMonthStartDate(today);

    const [submitting, setSubmitting] = useState(false);
    const [showOtConfirmModal, setShowOtConfirmModal] = useState(false);
    const [estimatedOtMinutes, setEstimatedOtMinutes] = useState(null);
    const [modalError, setModalError] = useState('');
    const [scheduleItemsByDate, setScheduleItemsByDate] = useState({});
    const [attendanceItemsByDate, setAttendanceItemsByDate] = useState({});
    const [attendanceContextLoaded, setAttendanceContextLoaded] = useState(false);

    const otMode = formData.otMode || OT_MODE_CONTINUOUS;
    const isSeparated = otMode === OT_MODE_SEPARATED;
    const selectedAttendanceItem = formData.date ? attendanceItemsByDate[formData.date] || null : null;
    const selectedScheduleItem = formData.date ? scheduleItemsByDate[formData.date] || null : null;
    const selectedScheduleType = normalizeScheduleType(
        selectedAttendanceItem?.scheduleType || selectedScheduleItem?.scheduleType
    );
    const isFlexibleSelectedDay = isFlexibleScheduleType(selectedScheduleType);
    const selectedFixedShiftPolicy = getFixedShiftPolicy(selectedScheduleType);
    const selectedActualCheckoutAt = selectedAttendanceItem?.checkOutAt
        ? new Date(selectedAttendanceItem.checkOutAt)
        : null;
    const selectedActualCheckoutTimeKey = formatTimeKeyInVn(selectedActualCheckoutAt);
    const selectedActualCheckoutDateKey = formatDateKeyInVn(selectedActualCheckoutAt);
    const currentTimeKey = getCurrentTimeKeyInVn();
    const isCurrentTimeBeforeCutoff = currentTimeKey < OT_CROSS_MIDNIGHT_CUTOFF;
    const isSelectedToday = formData.date === today;
    const isSelectedTomorrow = Boolean(tomorrow) && formData.date === tomorrow;
    const isPastSelectedDate = Boolean(formData.date) && formData.date < today;
    const isPastSelectedDateWithinCurrentMonth =
        Boolean(formData.date) &&
        formData.date >= currentMonthStart &&
        formData.date < today;
    const isPastFixedShiftSelectedDay =
        isPastSelectedDateWithinCurrentMonth &&
        Boolean(selectedFixedShiftPolicy) &&
        !isFlexibleSelectedDay;
    const shouldUseFixedPastContinuousCheckoutEnd =
        otMode === OT_MODE_CONTINUOUS && isPastFixedShiftSelectedDay;
    const effectiveEstimatedEndTimeValue =
        shouldUseFixedPastContinuousCheckoutEnd && selectedActualCheckoutTimeKey
            ? selectedActualCheckoutTimeKey
            : formData.estimatedEndTime;
    const canUsePastFlexibleWindow = isFlexibleSelectedDay && isPastSelectedDateWithinCurrentMonth;
    const shouldShowContinuousOtStart = otMode === OT_MODE_CONTINUOUS && isFlexibleSelectedDay;
    const canUseSameMorningCarryOverWindow = isSeparated && isSelectedToday && isCurrentTimeBeforeCutoff;
    const canUseTomorrowPreRegisterWindow = isSeparated && isSelectedTomorrow;
    const canAnchorSeparatedToPreviousDay =
        canUseSameMorningCarryOverWindow || canUseTomorrowPreRegisterWindow;
    const carryOverAnchorDate = canAnchorSeparatedToPreviousDay && formData.date
        ? addDaysToDate(formData.date, -1)
        : null;
    const carryOverAttendanceItem = carryOverAnchorDate
        ? attendanceItemsByDate[carryOverAnchorDate] || null
        : null;
    const carryOverFixedShiftPolicy = getFixedShiftPolicy(carryOverAttendanceItem?.scheduleType);
    const hasEarlySeparatedStart = isSeparated && Boolean(formData.otStartTime) && isCrossMidnightOt(formData.otStartTime);
    const hasEarlySeparatedEnd = isSeparated && Boolean(formData.estimatedEndTime) && isCrossMidnightOt(formData.estimatedEndTime);
    const isCarryOverSeparatedActive = canAnchorSeparatedToPreviousDay && hasEarlySeparatedStart && hasEarlySeparatedEnd;
    const isTomorrowPreRegisterActive = canUseTomorrowPreRegisterWindow && isCarryOverSeparatedActive;
    const carryOverAnchorDisplay = formatDisplayDate(carryOverAnchorDate);
    const actualOtDateDisplay = formatDisplayDate(formData.date);

    useEffect(() => {
        let active = true;
        const monthsToFetch = Array.from(
            new Set(
                [today.slice(0, 7), addDaysToDate(today, -1)?.slice(0, 7)].filter(Boolean)
            )
        );

        Promise.all([
            getMyWorkSchedules(),
            Promise.all(monthsToFetch.map((month) => getMyAttendance(month))),
        ])
            .then(([scheduleRes, attendanceResponses]) => {
                if (!active) return;

                const nextItemsByDate = {};
                const scheduleItems = Array.isArray(scheduleRes?.data?.items) ? scheduleRes.data.items : [];
                scheduleItems.forEach((item) => {
                    if (item?.workDate) {
                        nextItemsByDate[item.workDate] = item;
                    }
                });
                setScheduleItemsByDate(nextItemsByDate);

                const nextAttendanceItemsByDate = {};
                attendanceResponses.forEach((response) => {
                    const attendanceItems = Array.isArray(response?.data?.items) ? response.data.items : [];
                    attendanceItems.forEach((item) => {
                        if (item?.date) {
                            nextAttendanceItemsByDate[item.date] = item;
                        }
                    });
                });
                setAttendanceItemsByDate(nextAttendanceItemsByDate);
                setAttendanceContextLoaded(true);
            })
            .catch(() => {
                if (active) {
                    setScheduleItemsByDate({});
                    setAttendanceItemsByDate({});
                    setAttendanceContextLoaded(true);
                }
            });

        return () => {
            active = false;
        };
    }, [today]);

    const handleInputChange = (e) => {
        const { name, value } = e.target;

        if (name === 'otMode') {
            onFieldChange('otMode', value);
            if (value === OT_MODE_CONTINUOUS && !isFlexibleSelectedDay) {
                onFieldChange('otStartTime', '');
            }
            return;
        }

        onFieldChange(name, value);
    };

    const getPreviewRange = () => {
        const { date, otStartTime } = formData;
        const estimatedEndTime = effectiveEstimatedEndTimeValue;
        if (!date || !estimatedEndTime) {
            return { start: null, end: null, minutes: 0, endDate: null, startDate: null };
        }

        const endDate = resolveOtDate(
            date,
            estimatedEndTime,
            isSeparated && canAnchorSeparatedToPreviousDay
        );
        const end = parseVnDateTime(endDate, estimatedEndTime);
        if (!end) {
            return { start: null, end: null, minutes: 0, endDate, startDate: null };
        }

        if (otMode === OT_MODE_SEPARATED) {
            if (!otStartTime) {
                return { start: null, end, minutes: 0, endDate, startDate: null };
            }
            const startDate = resolveOtDate(
                date,
                otStartTime,
                canAnchorSeparatedToPreviousDay
            );
            const start = parseVnDateTime(startDate, otStartTime);
            if (!start) {
                return { start: null, end, minutes: 0, endDate, startDate };
            }
            const minutes = Math.floor((end - start) / 60000);
            return {
                start,
                end,
                minutes: Number.isFinite(minutes) ? minutes : 0,
                endDate,
                startDate,
            };
        }

        if (isFlexibleSelectedDay) {
            if (!otStartTime) {
                return { start: null, end, minutes: null, endDate, startDate: date };
            }

            const start = parseVnDateTime(date, otStartTime);
            if (!start) {
                return { start: null, end, minutes: 0, endDate, startDate: date };
            }

            const minutes = Math.floor((end - start) / 60000);
            return {
                start,
                end,
                minutes: Number.isFinite(minutes) ? minutes : null,
                endDate,
                startDate: date,
            };
        }

        if (!selectedFixedShiftPolicy) {
            return { start: null, end, minutes: null, endDate, startDate: date };
        }

        const start = parseVnDateTime(date, selectedFixedShiftPolicy.threshold);
        const minutes = Math.floor((end - start) / 60000);
        return {
            start,
            end,
            minutes: Number.isFinite(minutes) ? minutes : null,
            endDate,
            startDate: date,
        };
    };

    const validateOtRequest = () => {
        const { date, reason, otStartTime } = formData;
        const estimatedEndTime = effectiveEstimatedEndTimeValue;

        if (!date) return { valid: false, error: 'Vui lòng chọn ngày làm OT' };
        if (!reason?.trim()) return { valid: false, error: 'Vui lòng nhập lý do' };

        const todayStr = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
        const monthStart = getMonthStartDate(todayStr);
        const isPastDate = date < todayStr;
        const isPastDateWithinCurrentMonth = date >= monthStart && date < todayStr;
        const isPastFixedShiftDate =
            isPastDateWithinCurrentMonth &&
            Boolean(selectedFixedShiftPolicy) &&
            !isFlexibleSelectedDay;

        if (![OT_MODE_CONTINUOUS, OT_MODE_SEPARATED].includes(otMode)) {
            return { valid: false, error: 'Loại OT không hợp lệ' };
        }

        if (isPastDate && !isPastDateWithinCurrentMonth) {
            return {
                valid: false,
                error: 'OT chỉ hỗ trợ đăng ký quá khứ trong tháng hiện tại (GMT+7)',
            };
        }

        if (isPastDate && !isFlexibleSelectedDay && !selectedFixedShiftPolicy) {
            return {
                valid: false,
                error: 'OT quá khứ trong tháng hiện tại hiện chỉ hỗ trợ cho Ca 1, Ca 2 hoặc ngày có lịch Linh hoạt',
            };
        }

        if (!estimatedEndTime) {
            return { valid: false, error: 'Vui lòng nhập giờ kết thúc OT' };
        }

        const endDate = resolveOtDate(
            date,
            estimatedEndTime,
            otMode === OT_MODE_SEPARATED && canAnchorSeparatedToPreviousDay
        );
        const endTime = parseVnDateTime(endDate, estimatedEndTime);
        if (!endTime) {
            return { valid: false, error: 'Giờ kết thúc OT không hợp lệ' };
        }

        if (date === todayStr && endTime <= new Date()) {
            return {
                valid: false,
                error: 'Giờ kết thúc OT phải sau thời điểm hiện tại',
            };
        }

        if (otMode === OT_MODE_CONTINUOUS) {
            if (isFlexibleSelectedDay) {
                if (!otStartTime) {
                    return {
                        valid: false,
                        error: 'Vui lòng nhập giờ bắt đầu OT cho lịch Linh hoạt',
                    };
                }

                const startTime = parseVnDateTime(date, otStartTime);
                if (!startTime) {
                    return { valid: false, error: 'Giờ bắt đầu OT không hợp lệ' };
                }

                if (endTime <= startTime) {
                    return { valid: false, error: 'Giờ kết thúc phải sau giờ bắt đầu OT' };
                }

                const minutes = Math.floor((endTime - startTime) / 60000);
                if (minutes < 30) {
                    return { valid: false, error: 'Thời gian OT tối thiểu là 30 phút' };
                }

                const actualCheckIn = selectedAttendanceItem?.checkInAt
                    ? new Date(selectedAttendanceItem.checkInAt)
                    : null;
                const actualCheckOut = selectedAttendanceItem?.checkOutAt
                    ? new Date(selectedAttendanceItem.checkOutAt)
                    : null;

                if (isPastDateWithinCurrentMonth) {
                    if (!attendanceContextLoaded) {
                        return {
                            valid: false,
                            error: 'Đang tải attendance của ngày quá khứ, vui lòng thử lại sau ít giây',
                        };
                    }

                    if (!selectedAttendanceItem?.checkInAt || !selectedAttendanceItem?.checkOutAt) {
                        return {
                            valid: false,
                            error: 'Ngày quá khứ của lịch Linh hoạt phải có attendance đã hoàn tất trước khi đăng ký OT',
                        };
                    }
                }

                if (actualCheckIn && !isNaN(actualCheckIn.getTime()) && startTime < actualCheckIn) {
                    return {
                        valid: false,
                        error: 'Giờ bắt đầu OT không thể trước thời điểm check-in thực tế',
                    };
                }

                if (actualCheckOut && !isNaN(actualCheckOut.getTime()) && startTime >= actualCheckOut) {
                    return {
                        valid: false,
                        error: 'Giờ bắt đầu OT phải trước thời điểm check-out thực tế',
                    };
                }

                return {
                    valid: true,
                    error: '',
                    otMinutes: minutes,
                    endOffsetDays: isCrossMidnightOt(estimatedEndTime) ? 1 : 0,
                    otStartOffsetDays: 0,
                };
            }

            if (isPastFixedShiftDate) {
                if (!attendanceContextLoaded) {
                    return {
                        valid: false,
                        error: 'Đang tải attendance của ngày quá khứ, vui lòng thử lại sau ít giây',
                    };
                }

                if (!selectedAttendanceItem?.checkInAt || !selectedAttendanceItem?.checkOutAt) {
                    return {
                        valid: false,
                        error: 'Ngày quá khứ của Ca 1/Ca 2 phải có attendance đã hoàn tất trước khi đăng ký OT',
                    };
                }

                if (!selectedActualCheckoutAt || Number.isNaN(selectedActualCheckoutAt.getTime())) {
                    return {
                        valid: false,
                        error: 'Không đọc được giờ check-out thực tế để tạo OT quá khứ',
                    };
                }

                const nextDate = addDaysToDate(date, 1);
                const checkoutIsCrossMidnight = selectedActualCheckoutDateKey === nextDate;
                const checkoutDateAllowed =
                    selectedActualCheckoutDateKey === date || checkoutIsCrossMidnight;

                if (!checkoutDateAllowed) {
                    return {
                        valid: false,
                        error: 'Attendance của ngày quá khứ có giờ check-out không hợp lệ để đăng ký OT',
                    };
                }

                if (checkoutIsCrossMidnight && selectedActualCheckoutTimeKey >= OT_CROSS_MIDNIGHT_CUTOFF) {
                    return {
                        valid: false,
                        error: 'OT quá khứ liên tục của Ca 1/Ca 2 không hỗ trợ attendance check-out từ 08:00 trở đi của ngày hôm sau',
                    };
                }

                const continuousStart = parseVnDateTime(date, selectedFixedShiftPolicy.threshold);
                const minutes = continuousStart
                    ? Math.floor((selectedActualCheckoutAt - continuousStart) / 60000)
                    : null;
                if (Number.isFinite(minutes) && minutes < 30) {
                    return {
                        valid: false,
                        error: `Giờ check-out thực tế phải đạt tối thiểu ${selectedFixedShiftPolicy.earliestEnd} để đủ 30 phút OT`,
                    };
                }

                return {
                    valid: true,
                    error: '',
                    otMinutes: Number.isFinite(minutes) ? minutes : null,
                    endOffsetDays: checkoutIsCrossMidnight ? 1 : 0,
                    otStartOffsetDays: 0,
                };
            }

            if (
                selectedFixedShiftPolicy &&
                !isCrossMidnightOt(estimatedEndTime) &&
                estimatedEndTime < selectedFixedShiftPolicy.threshold
            ) {
                return {
                    valid: false,
                    error: `OT liên tục không thể kết thúc trước ${selectedFixedShiftPolicy.threshold} (GMT+7)`,
                };
            }

            const continuousStart = selectedFixedShiftPolicy
                ? parseVnDateTime(date, selectedFixedShiftPolicy.threshold)
                : null;
            const minutes = continuousStart
                ? Math.floor((endTime - continuousStart) / 60000)
                : null;
            if (Number.isFinite(minutes) && minutes < 30) {
                return { valid: false, error: 'Thời gian OT tối thiểu là 30 phút' };
            }

            return {
                valid: true,
                error: '',
                otMinutes: Number.isFinite(minutes) ? minutes : null,
                endOffsetDays: isCrossMidnightOt(estimatedEndTime) ? 1 : 0,
                otStartOffsetDays: 0,
            };
        }

        const allowsPastFlexibleSeparated = isFlexibleSelectedDay && isPastDateWithinCurrentMonth;
        const allowsPastFixedSeparated = isPastFixedShiftDate;
        if (!isSelectedToday && !isSelectedTomorrow && !allowsPastFlexibleSeparated && !allowsPastFixedSeparated) {
            return {
                valid: false,
                error: isFlexibleSelectedDay
                    ? 'OT tách rời cho lịch Linh hoạt chỉ hỗ trợ ngày hiện tại, quá khứ trong tháng hiện tại hoặc phiên rạng sáng ngày mai (GMT+7)'
                    : 'OT tách rời chỉ hỗ trợ ngày hiện tại, quá khứ trong tháng hiện tại của Ca 1/Ca 2 hoặc phiên rạng sáng ngày mai (GMT+7)',
            };
        }

        if (!otStartTime) {
            return { valid: false, error: 'Vui lòng nhập giờ bắt đầu OT tách rời' };
        }

        if (canAnchorSeparatedToPreviousDay && !hasEarlySeparatedStart && !hasEarlySeparatedEnd) {
            return {
                valid: false,
                error: isSelectedTomorrow
                    ? 'Đăng ký trước OT tách rời cho ngày mai chỉ hỗ trợ phiên rạng sáng 00:00-07:59'
                    : 'Trong khung 00:00-07:59, OT tách rời chỉ hỗ trợ phiên rạng sáng neo vào ca ngày hôm trước',
            };
        }

        if (canAnchorSeparatedToPreviousDay && hasEarlySeparatedStart !== hasEarlySeparatedEnd) {
            return {
                valid: false,
                error: isSelectedTomorrow
                    ? 'Đăng ký trước OT tách rời cho ngày mai yêu cầu cả giờ bắt đầu và kết thúc nằm trong 00:00-07:59'
                    : 'OT tách rời rạng sáng yêu cầu cả giờ bắt đầu và kết thúc nằm trong 00:00-07:59',
            };
        }

        const startDate = resolveOtDate(
            date,
            otStartTime,
            canAnchorSeparatedToPreviousDay
        );
        const startTime = parseVnDateTime(startDate, otStartTime);
        if (!startTime) {
            return { valid: false, error: 'Giờ bắt đầu OT không hợp lệ' };
        }

        const effectiveSeparatedPolicy = isCarryOverSeparatedActive
            ? carryOverFixedShiftPolicy
            : selectedFixedShiftPolicy;
        const thresholdDate = isCarryOverSeparatedActive
            ? carryOverAnchorDate
            : date;

        if (isCarryOverSeparatedActive) {
            if (!attendanceContextLoaded) {
                return {
                    valid: false,
                    error: isSelectedTomorrow
                        ? 'Đang tải dữ liệu attendance của ca hôm nay, vui lòng thử lại sau ít giây'
                        : 'Đang tải dữ liệu ca ngày trước, vui lòng thử lại sau ít giây',
                };
            }

            if (!carryOverAnchorDate || !carryOverAttendanceItem?.checkInAt) {
                return {
                    valid: false,
                    error: isSelectedTomorrow
                        ? 'Chưa tìm thấy attendance ca hôm nay để đăng ký trước OT rạng sáng ngày mai'
                        : 'Không tìm thấy ca ngày trước đã hoàn tất để neo OT tách rời rạng sáng',
                };
            }

            if (!carryOverAttendanceItem?.checkOutAt) {
                return {
                    valid: false,
                    error: isSelectedTomorrow
                        ? 'Chưa thể đăng ký trước OT rạng sáng ngày mai vì ca hôm nay chưa check-out'
                        : 'Không tìm thấy ca ngày trước đã hoàn tất để neo OT tách rời rạng sáng',
                };
            }
        } else if (isFlexibleSelectedDay) {
            if (!attendanceContextLoaded) {
                return {
                    valid: false,
                    error: isPastDateWithinCurrentMonth
                        ? 'Đang tải attendance của ngày quá khứ, vui lòng thử lại sau ít giây'
                        : 'Đang tải attendance của ngày này, vui lòng thử lại sau ít giây',
                };
            }

            if (!selectedAttendanceItem?.checkInAt || !selectedAttendanceItem?.checkOutAt) {
                return {
                    valid: false,
                    error: isPastDateWithinCurrentMonth
                        ? 'Ngày quá khứ của lịch Linh hoạt phải có attendance đã hoàn tất trước khi đăng ký OT tách rời'
                        : 'Phải hoàn tất check-in và check-out của ngày này trước khi đăng ký OT tách rời cho lịch Linh hoạt',
                };
            }
        } else if (allowsPastFixedSeparated) {
            if (!attendanceContextLoaded) {
                return {
                    valid: false,
                    error: 'Đang tải attendance của ngày quá khứ, vui lòng thử lại sau ít giây',
                };
            }

            if (!selectedAttendanceItem?.checkInAt || !selectedAttendanceItem?.checkOutAt) {
                return {
                    valid: false,
                    error: 'Ngày quá khứ của Ca 1/Ca 2 phải có attendance đã hoàn tất trước khi đăng ký OT tách rời',
                };
            }
        }

        const threshold = effectiveSeparatedPolicy && thresholdDate
            ? parseVnDateTime(thresholdDate, effectiveSeparatedPolicy.threshold)
            : null;
        if (threshold && startTime < threshold) {
            return {
                valid: false,
                error: `Giờ bắt đầu OT tách rời phải từ ${effectiveSeparatedPolicy.threshold} (GMT+7)`,
            };
        }

        if (endTime <= startTime) {
            return { valid: false, error: 'Giờ kết thúc phải sau giờ bắt đầu OT' };
        }

        const minutes = Math.floor((endTime - startTime) / 60000);
        if (minutes < 30) {
            return { valid: false, error: 'Thời gian OT tối thiểu là 30 phút' };
        }

        if (isCarryOverSeparatedActive) {
            const checkoutAt = carryOverAttendanceItem?.checkOutAt
                ? new Date(carryOverAttendanceItem.checkOutAt)
                : null;
            if (!checkoutAt || isNaN(checkoutAt.getTime())) {
                return {
                    valid: false,
                    error: isSelectedTomorrow
                        ? 'Không đọc được giờ check-out của ca hôm nay để kiểm tra đăng ký trước OT'
                        : 'Không đọc được giờ check-out của ca ngày trước để kiểm tra OT tách rời',
                };
            }
            if (startTime <= checkoutAt) {
                return {
                    valid: false,
                    error: isSelectedTomorrow
                        ? 'Giờ bắt đầu OT phải sau thời điểm check-out của ca hôm nay'
                        : 'Giờ bắt đầu OT phải sau thời điểm check-out của ca ngày trước',
                };
            }
        } else if (isFlexibleSelectedDay) {
            const checkoutAt = selectedAttendanceItem?.checkOutAt
                ? new Date(selectedAttendanceItem.checkOutAt)
                : null;
            if (!checkoutAt || isNaN(checkoutAt.getTime())) {
                return {
                    valid: false,
                    error: 'Không đọc được giờ check-out thực tế để kiểm tra OT tách rời',
                };
            }
            if (startTime <= checkoutAt) {
                return {
                    valid: false,
                    error: 'Giờ bắt đầu OT phải sau thời điểm check-out thực tế',
                };
            }
        } else if (allowsPastFixedSeparated) {
            const checkoutAt = selectedAttendanceItem?.checkOutAt
                ? new Date(selectedAttendanceItem.checkOutAt)
                : null;
            if (!checkoutAt || isNaN(checkoutAt.getTime())) {
                return {
                    valid: false,
                    error: 'Không đọc được giờ check-out thực tế để kiểm tra OT tách rời quá khứ',
                };
            }
            if (startTime <= checkoutAt) {
                return {
                    valid: false,
                    error: 'Giờ bắt đầu OT phải sau thời điểm check-out thực tế của attendance ngày đó',
                };
            }
        }

        return {
            valid: true,
            error: '',
            otMinutes: minutes,
            endOffsetDays: isCarryOverSeparatedActive
                ? 0
                : isCrossMidnightOt(estimatedEndTime) ? 1 : 0,
            otStartOffsetDays: isCarryOverSeparatedActive
                ? 0
                : isCrossMidnightOt(otStartTime) ? 1 : 0,
        };
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        if (submitting) return;

        setFormError('');
        setFormSuccess('');
        setModalError('');

        const validation = validateOtRequest();
        if (!validation.valid) {
            setFormError(validation.error);
            return;
        }

        setEstimatedOtMinutes(validation.otMinutes ?? null);
        setShowOtConfirmModal(true);
    };

    const handleConfirmOtRequest = async () => {
        setSubmitting(true);
        setModalError('');

        try {
            const endOffsetDays =
                isCarryOverSeparatedActive
                    ? 0
                    : isCrossMidnightOt(effectiveEstimatedEndTimeValue) ? 1 : 0;
            const separatedStartOffsetDays =
                isCarryOverSeparatedActive
                    ? 0
                    : otMode === OT_MODE_SEPARATED && isCrossMidnightOt(formData.otStartTime)
                        ? 1
                        : 0;

            const payload = {
                type: 'OT_REQUEST',
                date: formData.date,
                otMode,
                estimatedEndTime: buildIsoTimestamp(
                    formData.date,
                    effectiveEstimatedEndTimeValue,
                    endOffsetDays
                ),
                reason: formData.reason.trim(),
            };

            if (otMode === OT_MODE_SEPARATED) {
                payload.otStartTime = buildIsoTimestamp(
                    formData.date,
                    formData.otStartTime,
                    separatedStartOffsetDays
                );
            } else if (shouldShowContinuousOtStart && formData.otStartTime) {
                payload.otStartTime = buildIsoTimestamp(
                    formData.date,
                    formData.otStartTime,
                    0
                );
            }

            await createRequest(payload);

            setFormSuccess('Đã gửi yêu cầu OT thành công!');
            setShowOtConfirmModal(false);
            onSuccess?.();
        } catch (err) {
            const errorMsg = err.response?.data?.message || 'Không thể tạo yêu cầu OT';
            setModalError(errorMsg);
        } finally {
            setSubmitting(false);
        }
    };

    const preview = getPreviewRange();
    const isCrossDayOt =
        Boolean(effectiveEstimatedEndTimeValue) &&
        !isCarryOverSeparatedActive &&
        isCrossMidnightOt(effectiveEstimatedEndTimeValue);
    const nextDayDisplay = isCrossDayOt && formData.date ? getNextDayDisplay(formData.date) : '';
    const scheduleHelperText = (() => {
        if (isCarryOverSeparatedActive && carryOverAnchorDate) {
            if (carryOverFixedShiftPolicy) {
                return `OT rạng sáng ngày ${actualOtDateDisplay} sẽ neo vào ${carryOverFixedShiftPolicy.label} ngày ${carryOverAnchorDisplay}.`;
            }

            return `OT rạng sáng ngày ${actualOtDateDisplay} sẽ neo vào attendance đã hoàn tất của ngày ${carryOverAnchorDisplay}.`;
        }

        if (isSelectedTomorrow && carryOverAnchorDate) {
            return `Sau khi checkout ca ngày ${carryOverAnchorDisplay}, bạn có thể đăng ký trước OT rạng sáng ngày ${actualOtDateDisplay} trong khung 00:00-07:59.`;
        }

        if (canUseSameMorningCarryOverWindow) {
            return 'Trong khung 00:00-07:59, OT tách rời hỗ trợ phiên rạng sáng và sẽ neo vào ca đã hoàn tất của ngày hôm trước.';
        }

        if (isFlexibleSelectedDay && otMode === OT_MODE_CONTINUOUS) {
            return isPastSelectedDateWithinCurrentMonth
                ? 'Lịch Linh hoạt: bạn có thể đăng ký OT cho ngày quá khứ trong tháng hiện tại. OT sẽ tính theo block từ giờ bắt đầu OT đến thời điểm checkout thực tế.'
                : 'Lịch Linh hoạt: OT liên tục sẽ tính theo block từ giờ bắt đầu OT đến min(giờ checkout thực tế, giờ kết thúc đã đăng ký).';
        }

        if (isFlexibleSelectedDay && otMode === OT_MODE_SEPARATED) {
            return isPastSelectedDateWithinCurrentMonth
                ? 'Lịch Linh hoạt: OT tách rời cho ngày quá khứ chỉ hợp lệ khi attendance ngày đó đã hoàn tất.'
                : 'Lịch Linh hoạt: OT tách rời là phiên làm thêm sau checkout của ngày đã chọn.';
        }

        if (shouldUseFixedPastContinuousCheckoutEnd && selectedFixedShiftPolicy) {
            return `${selectedFixedShiftPolicy.label}: OT liên tục của ngày quá khứ sẽ đối chiếu theo giờ checkout thực tế của attendance đã hoàn tất.`;
        }

        if (isSeparated && isPastFixedShiftSelectedDay && selectedFixedShiftPolicy) {
            return `${selectedFixedShiftPolicy.label}: OT tách rời của ngày quá khứ chỉ hợp lệ sau giờ checkout thực tế của attendance ngày đó.`;
        }

        if (selectedFixedShiftPolicy) {
            return `${selectedFixedShiftPolicy.label}: OT bắt đầu từ ${selectedFixedShiftPolicy.threshold}, tối thiểu cùng ngày đến ${selectedFixedShiftPolicy.earliestEnd}.`;
        }

        return 'Hệ thống sẽ đối chiếu theo ca đã đăng ký của ngày này khi tạo yêu cầu.';
    })();

    const separatedThresholdPolicy = isCarryOverSeparatedActive
        ? carryOverFixedShiftPolicy
        : selectedFixedShiftPolicy;
    const shouldRenderOtStartInput = isSeparated || shouldShowContinuousOtStart;

    return (
        <>
            <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-4 p-4 bg-purple-50 border border-purple-200 rounded-lg">
                    <div className="flex items-center space-x-2 mb-2">
                        <svg className="w-5 h-5 text-purple-600" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
                        </svg>
                        <h3 className="font-semibold text-purple-900">Đăng ký làm thêm giờ (OT)</h3>
                    </div>

                    <div>
                        <Label htmlFor="ot-mode" value="Loại OT *" />
                        <Select
                            id="ot-mode"
                            name="otMode"
                            value={otMode}
                            onChange={handleInputChange}
                            required
                        >
                            <option value={OT_MODE_CONTINUOUS}>Làm thêm liên tục</option>
                            <option value={OT_MODE_SEPARATED}>Phiên tách rời</option>
                        </Select>
                    </div>

                    <div>
                        <Label htmlFor="ot-date" value="Ngày làm OT *" />
                        <TextInput
                            id="ot-date"
                            name="date"
                            type="date"
                            value={formData.date}
                            onChange={handleInputChange}
                            min={currentMonthStart}
                            required
                        />
                        <p className="text-xs text-gray-600 mt-1">
                            {isSeparated
                                ? isCarryOverSeparatedActive && carryOverAnchorDate
                                    ? `OT rạng sáng ngày ${actualOtDateDisplay} sẽ được neo vào ca ngày ${carryOverAnchorDisplay}`
                                    : isSelectedTomorrow && carryOverAnchorDate
                                        ? `Đăng ký trước OT rạng sáng ngày ${actualOtDateDisplay} sẽ đối chiếu vào ca ngày ${carryOverAnchorDisplay} sau khi bạn checkout`
                                        : isFlexibleSelectedDay
                                            ? 'OT tách rời lịch Linh hoạt hỗ trợ ngày hiện tại, quá khứ trong tháng hiện tại và phiên rạng sáng ngày mai sau checkout'
                                            : isPastFixedShiftSelectedDay
                                                ? 'OT tách rời của Ca 1/Ca 2 hỗ trợ ngày hiện tại, quá khứ trong tháng hiện tại khi attendance đã hoàn tất và phiên rạng sáng ngày mai sau checkout'
                                                : 'OT tách rời hỗ trợ ngày hiện tại; sau khi checkout có thể đăng ký trước phiên rạng sáng ngày mai (00:00-07:59)'
                                : isFlexibleSelectedDay
                                    ? 'OT liên tục lịch Linh hoạt hỗ trợ ngày hiện tại, tương lai và ngày quá khứ trong tháng hiện tại'
                                    : shouldUseFixedPastContinuousCheckoutEnd
                                        ? 'OT liên tục của Ca 1/Ca 2 hỗ trợ ngày hiện tại, tương lai và ngày quá khứ trong tháng hiện tại'
                                        : 'OT liên tục hỗ trợ ngày hiện tại hoặc tương lai'}
                        </p>
                        <p className="text-xs text-gray-600 mt-1">{scheduleHelperText}</p>
                    </div>

                    {shouldRenderOtStartInput && (
                        <div>
                            <Label
                                htmlFor="ot-start-time"
                                value={isSeparated ? 'Giờ bắt đầu OT *' : 'Giờ bắt đầu OT linh hoạt *'}
                            />
                            <TextInput
                                id="ot-start-time"
                                name="otStartTime"
                                type="time"
                                value={formData.otStartTime || ''}
                                onChange={handleInputChange}
                                required={shouldRenderOtStartInput}
                            />
                            <div className="text-xs text-gray-600 mt-1 space-y-1">
                                {isSeparated ? (
                                    <>
                                        <p>
                                            {separatedThresholdPolicy
                                                ? `Giờ bắt đầu phải từ ${separatedThresholdPolicy.threshold} (GMT+7)`
                                                : 'Giờ bắt đầu sẽ được kiểm tra theo attendance đã hoàn tất của ngày này'}
                                        </p>
                                        <p>
                                            {canAnchorSeparatedToPreviousDay
                                                ? 'Trong khung 00:00-07:59, giờ sẽ giữ trên ngày đã chọn và hệ thống sẽ neo vào ca ngày hôm trước'
                                                : 'Giờ 00:00-07:59 sẽ được tính là ngày hôm sau'}
                                        </p>
                                    </>
                                ) : (
                                    <>
                                        <p>OT linh hoạt sẽ tính từ giờ bắt đầu này đến min(checkout thực tế, giờ kết thúc đã đăng ký)</p>
                                        <p>Giờ bắt đầu nên nằm trong cùng ngày làm việc đã chọn</p>
                                    </>
                                )}
                            </div>
                        </div>
                    )}

                    <div>
                        <Label htmlFor="ot-time" value="Giờ kết thúc OT *" />
                        <TextInput
                            id="ot-time"
                            name="estimatedEndTime"
                            type="time"
                            value={effectiveEstimatedEndTimeValue}
                            onChange={handleInputChange}
                            required
                            readOnly={shouldUseFixedPastContinuousCheckoutEnd}
                        />
                        <div className="text-xs text-gray-600 mt-1 space-y-1">
                            {!isSeparated && !shouldShowContinuousOtStart && (
                                <p>
                                    {shouldUseFixedPastContinuousCheckoutEnd && selectedActualCheckoutTimeKey
                                        ? `Giờ kết thúc OT đang khóa theo checkout thực tế: ${selectedActualCheckoutTimeKey}`
                                        : selectedFixedShiftPolicy
                                        ? `OT liên tục cùng ngày tối thiểu đến ${selectedFixedShiftPolicy.earliestEnd}`
                                        : 'OT liên tục cùng ngày sẽ được đối chiếu theo ca đã đăng ký'}
                                </p>
                            )}
                            {!isSeparated && shouldShowContinuousOtStart && (
                                <p>
                                    Giờ kết thúc của OT linh hoạt có thể qua ngày hôm sau, nhưng nếu checkout sớm hơn thì OT sẽ bị cắt theo checkout thực tế
                                </p>
                            )}
                            <p>
                                {isCarryOverSeparatedActive
                                    ? 'Giờ kết thúc đang được hiểu theo ngày OT thực tế đã chọn'
                                    : isSelectedTomorrow
                                        ? 'Khi đăng ký trước cho ngày mai, giờ 00:00-07:59 sẽ giữ trên ngày OT thực tế đã chọn'
                                    : 'Giờ 00:00-07:59 sẽ được tính là ngày hôm sau'}
                            </p>
                            <p>Tối thiểu 30 phút</p>
                        </div>
                        {formData.date && isCrossDayOt && (
                            <p className="text-xs text-indigo-600 mt-1">
                                Giờ kết thúc sẽ tính là ngày hôm sau ({nextDayDisplay})
                            </p>
                        )}
                    </div>

                    {formData.date && effectiveEstimatedEndTimeValue && Number.isFinite(preview.minutes) && preview.minutes > 0 && (
                        <Alert color={preview.minutes >= 30 ? 'success' : 'warning'}>
                            <div className="flex items-center">
                                <span className="font-semibold mr-2">Thời gian OT dự kiến:</span>
                                <span className="text-lg">{formatMinutes(preview.minutes)}</span>
                                {preview.minutes < 30 && (
                                    <span className="ml-2 text-sm">(Tối thiểu 30 phút)</span>
                                )}
                            </div>
                        </Alert>
                    )}

                    <div>
                        <Label htmlFor="ot-reason" value="Lý do *" />
                        <Textarea
                            id="ot-reason"
                            name="reason"
                            value={formData.reason}
                            onChange={handleInputChange}
                            placeholder="Ví dụ: Deploy production, Fix critical bug..."
                            rows={3}
                            required
                        />
                    </div>

                    <Alert color="warning">
                        <div className="text-sm">
                            <p className="font-semibold mb-1">Lưu ý:</p>
                            <ul className="list-disc list-inside space-y-1 text-xs">
                                {isSeparated ? (
                                    <>
                                        <li>Phải hoàn tất check-in và check-out ca chính trước khi đăng ký</li>
                                        <li>Giờ bắt đầu OT phải sau thời điểm check-out ca chính</li>
                                        {isCarryOverSeparatedActive && carryOverAnchorDate && (
                                            <li>
                                                Phiên rạng sáng sẽ được neo vào attendance ngày {carryOverAnchorDisplay}
                                                {isTomorrowPreRegisterActive ? ' và được tạo trước cho ngày hôm sau' : ''}
                                            </li>
                                        )}
                                        <li>Yêu cầu vẫn cần manager phê duyệt</li>
                                    </>
                                ) : shouldShowContinuousOtStart ? (
                                    <>
                                        <li>OT lịch Linh hoạt sẽ tính theo block từ giờ bắt đầu OT đến min(checkout thực tế, giờ kết thúc đã đăng ký)</li>
                                        <li>Ngày quá khứ trong tháng hiện tại chỉ hợp lệ khi attendance ngày đó đã hoàn tất</li>
                                        <li>Sau khi yêu cầu được duyệt, OT của ngày quá khứ sẽ được áp ngay vào attendance của ngày đó</li>
                                    </>
                                ) : shouldUseFixedPastContinuousCheckoutEnd ? (
                                    <>
                                        <li>OT liên tục quá khứ của Ca 1/Ca 2 sẽ đối chiếu theo giờ checkout thực tế của attendance ngày đó</li>
                                        <li>Giờ kết thúc OT đang khóa theo checkout thực tế; nếu checkout sang hôm sau thì phải trước 08:00</li>
                                        <li>Sau khi yêu cầu được duyệt, OT của ngày quá khứ sẽ được áp ngay vào attendance của ngày đó</li>
                                    </>
                                ) : (
                                    <>
                                        <li>Phải có approval từ manager trước khi checkout</li>
                                        <li>Nếu không có approval: giờ làm chỉ tính trong khung ca đã đăng ký, OT = 0</li>
                                    </>
                                )}
                            </ul>
                        </div>
                    </Alert>
                </div>

                <Button type="submit" disabled={submitting} color="cyan">
                    {submitting ? <Spinner size="sm" className="mr-2" /> : <HiPlus className="mr-2" />}
                    Tạo yêu cầu
                </Button>
            </form>

            <Modal
                show={showOtConfirmModal}
                onClose={() => !submitting && setShowOtConfirmModal(false)}
                size="lg"
            >
                <Modal.Header>
                    <div className="flex items-center space-x-2">
                        <svg className="w-6 h-6 text-purple-600" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
                        </svg>
                        <span>Xác nhận đăng ký OT</span>
                    </div>
                </Modal.Header>

                <Modal.Body>
                    <div className="space-y-4">
                        <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                            <h3 className="font-semibold text-purple-900 mb-3">
                                Thông tin đăng ký OT
                            </h3>

                            <div className="space-y-2">
                                <div className="flex justify-between">
                                    <span className="text-gray-600">Loại OT:</span>
                                    <span className="font-medium">
                                        {isSeparated ? 'Phiên tách rời' : 'Làm thêm liên tục'}
                                    </span>
                                </div>

                                <div className="flex justify-between">
                                    <span className="text-gray-600">
                                        {isSeparated ? 'Ngày OT thực tế:' : 'Ngày:'}
                                    </span>
                                    <span className="font-medium">
                                        {formatDisplayDate(formData.date)}
                                    </span>
                                </div>

                                {isCarryOverSeparatedActive && carryOverAnchorDate && (
                                    <div className="flex justify-between">
                                        <span className="text-gray-600">Ngày neo ca chính:</span>
                                        <span className="font-medium">{carryOverAnchorDisplay}</span>
                                    </div>
                                )}

                                {isSeparated && (
                                    <div className="flex justify-between">
                                        <span className="text-gray-600">Bắt đầu OT:</span>
                                        <span className="font-medium">
                                            {formData.otStartTime}
                                            {!isCarryOverSeparatedActive && isCrossMidnightOt(formData.otStartTime) && nextDayDisplay && ` (ngày ${nextDayDisplay})`}
                                        </span>
                                    </div>
                                )}

                                {!isSeparated && shouldShowContinuousOtStart && (
                                    <div className="flex justify-between">
                                        <span className="text-gray-600">Bắt đầu OT:</span>
                                        <span className="font-medium">{formData.otStartTime}</span>
                                    </div>
                                )}

                                <div className="flex justify-between">
                                    <span className="text-gray-600">Kết thúc OT:</span>
                                    <span className="font-medium">
                                        {effectiveEstimatedEndTimeValue}
                                        {isCrossDayOt && nextDayDisplay && ` (ngày ${nextDayDisplay})`}
                                    </span>
                                </div>

                                <div className="flex justify-between bg-green-50 rounded p-2">
                                    <span className="text-gray-600">Thời gian OT:</span>
                                    <span className="font-bold text-green-600">
                                        {Number.isFinite(estimatedOtMinutes)
                                            ? formatMinutes(estimatedOtMinutes)
                                            : 'Sẽ được xác định theo ca đã đăng ký'}
                                    </span>
                                </div>

                                <div className="pt-2 border-t">
                                    <span className="text-gray-600 block mb-1">Lý do:</span>
                                    <p className="font-medium bg-white p-2 rounded border">
                                        {formData.reason}
                                    </p>
                                </div>
                            </div>
                        </div>

                        {modalError && (
                            <Alert color="failure">
                                {modalError}
                            </Alert>
                        )}

                        <Alert color="warning">
                            <div className="text-sm">
                                <p className="font-semibold mb-1">Lưu ý:</p>
                                <ul className="list-disc list-inside space-y-1 text-xs">
                                    <li>Yêu cầu OT cần quản lý phê duyệt</li>
                                    {isSeparated ? (
                                        <>
                                            <li>OT tách rời chỉ hợp lệ sau khi đã hoàn tất ca chính</li>
                                            {isCarryOverSeparatedActive && carryOverAnchorDate && (
                                                <li>
                                                    Phiên rạng sáng này sẽ được neo vào attendance ngày {carryOverAnchorDisplay}
                                                    {isTomorrowPreRegisterActive ? ' và vẫn được tính vào ngày neo này' : ''}
                                                </li>
                                            )}
                                        </>
                                    ) : shouldShowContinuousOtStart ? (
                                        <>
                                            <li>OT lịch Linh hoạt sẽ được tính theo block đã đăng ký và bị cắt theo checkout thực tế</li>
                                            <li>Nếu đây là ngày quá khứ trong tháng hiện tại, attendance ngày đó sẽ được cập nhật ngay sau khi duyệt</li>
                                        </>
                                    ) : shouldUseFixedPastContinuousCheckoutEnd ? (
                                        <>
                                            <li>OT liên tục quá khứ của Ca 1/Ca 2 sẽ được đối chiếu theo giờ checkout thực tế của attendance ngày đó</li>
                                            <li>Nếu checkout thực tế thay đổi sau khi tạo yêu cầu, manager sẽ không thể duyệt request cũ</li>
                                        </>
                                    ) : (
                                        <li>OT liên tục cần tạo trước khi checkout</li>
                                    )}
                                </ul>
                            </div>
                        </Alert>
                    </div>
                </Modal.Body>

                <Modal.Footer>
                    <Button
                        onClick={handleConfirmOtRequest}
                        disabled={submitting}
                        color="purple"
                    >
                        {submitting ? (
                            <>
                                <Spinner size="sm" className="mr-2" />
                                Đang gửi...
                            </>
                        ) : (
                            'Xác nhận gửi'
                        )}
                    </Button>

                    <Button
                        color="gray"
                        onClick={() => setShowOtConfirmModal(false)}
                        disabled={submitting}
                    >
                        Hủy
                    </Button>
                </Modal.Footer>
            </Modal>
        </>
    );
}
