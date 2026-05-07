import { getSeparatedOtDuration } from './dateUtils.js';

export const normalizeOtMode = (rawOtMode) =>
  rawOtMode === 'SEPARATED' ? 'SEPARATED' : 'CONTINUOUS';

export function buildApprovedAttendanceOtSnapshot(requestLike = {}) {
  const otMode = normalizeOtMode(requestLike?.otMode);

  if (otMode === 'SEPARATED') {
    const otStartTime = requestLike?.otStartTime ? new Date(requestLike.otStartTime) : null;
    const estimatedEndTime = requestLike?.estimatedEndTime ? new Date(requestLike.estimatedEndTime) : null;
    const separatedOtMinutes = (
      otStartTime &&
      estimatedEndTime &&
      !isNaN(otStartTime.getTime()) &&
      !isNaN(estimatedEndTime.getTime())
    )
      ? getSeparatedOtDuration(otStartTime, estimatedEndTime)
      : null;

    return {
      otApproved: true,
      otMode,
      separatedOtMinutes,
      approvedOtStartTime: null,
      approvedOtEndTime: null
    };
  }

  const hasExplicitContinuousWindow = requestLike?.otStartTime && requestLike?.estimatedEndTime;

  return {
    otApproved: true,
    otMode,
    separatedOtMinutes: null,
    approvedOtStartTime: hasExplicitContinuousWindow ? requestLike.otStartTime : null,
    approvedOtEndTime: hasExplicitContinuousWindow ? requestLike.estimatedEndTime : null
  };
}

export function buildClearedAttendanceOtSnapshot() {
  return {
    otApproved: false,
    otMode: null,
    separatedOtMinutes: null,
    approvedOtStartTime: null,
    approvedOtEndTime: null
  };
}
