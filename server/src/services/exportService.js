import ExcelJS from 'exceljs';
import mongoose from 'mongoose';
import Team from '../models/Team.js';
import { getMonthlyReport } from './reportService.js';

/**
 * Sanitize value to prevent Excel formula injection.
 * Prefix with single quote if starts with formula characters.
 * @param {unknown} value - Value to sanitize
 * @returns {string} Sanitized string
 */
function sanitizeForExcel(value) {
    const safe = String(value ?? '');
    return /^[=+\-@]/.test(safe) ? `'${safe}` : safe;
}

function toHours(minutes) {
    const numeric = Number((Number(minutes || 0) / 60).toFixed(1));
    return Number.isFinite(numeric) ? numeric : 0;
}

function toDateLabel(dateKey) {
    if (!dateKey || typeof dateKey !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
        return '';
    }
    const [, month, day] = dateKey.split('-');
    return `${day}/${month}`;
}

function formatReportTitle(month) {
    const [year, monthNum] = String(month || '').split('-');
    if (!year || !monthNum) {
        return 'BÁO CÁO CHẤM CÔNG THÁNG';
    }
    return `BÁO CÁO CHẤM CÔNG THÁNG ${monthNum}/${year}`;
}

async function resolveSubtitle(scope, teamId, summary) {
    if (scope !== 'team') {
        return 'Phạm vi: Toàn công ty';
    }

    const teamFromSummary = summary
        .map(item => item?.user?.teamName)
        .find(name => typeof name === 'string' && name.trim().length > 0);
    if (teamFromSummary) {
        return `Phạm vi: Team: ${sanitizeForExcel(teamFromSummary)}`;
    }

    if (teamId && mongoose.Types.ObjectId.isValid(teamId)) {
        const team = await Team.findById(teamId).select('name').lean();
        if (team?.name) {
            return `Phạm vi: Team: ${sanitizeForExcel(team.name)}`;
        }
    }

    return 'Phạm vi: Team';
}

function setCellBorders(worksheet, fromRow = 1) {
    worksheet.eachRow({ includeEmpty: false }, (row) => {
        if (row.number < fromRow) {
            return;
        }
        row.eachCell({ includeEmpty: true }, (cell) => {
            cell.border = {
                top: { style: 'thin' },
                left: { style: 'thin' },
                bottom: { style: 'thin' },
                right: { style: 'thin' }
            };
        });
    });
}

/**
 * Generate Excel file for monthly report.
 * Reuses reportService.getMonthlyReport() for data.
 * 
 * @param {string} scope - 'team' or 'company'
 * @param {string} month - "YYYY-MM" format
 * @param {string} teamId - Required if scope is 'team'
 * @param {Set<string>} holidayDates - Set of holiday dateKeys (optional)
 * @returns {Promise<Buffer>} Excel file buffer
 */
export const generateMonthlyExportExcel = async (scope, month, teamId, holidayDates = new Set()) => {
    const reportData = await getMonthlyReport(scope, month, teamId, holidayDates);
    const summary = Array.isArray(reportData?.summary) ? reportData.summary : [];

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Attendance App';
    workbook.created = new Date();

    const summarySheet = workbook.addWorksheet('Báo cáo tổng hợp');
    const summaryColumns = [
        { header: 'Mã NV', key: 'employeeCode', width: 14 },
        { header: 'Tên NV', key: 'name', width: 24 },
        { header: 'Phòng ban', key: 'teamName', width: 20 },
        { header: 'Ngày công tháng', key: 'totalWorkdays', width: 15 },
        { header: 'Có mặt', key: 'presentDays', width: 10 },
        { header: 'Chưa đăng ký ca', key: 'unregisteredDays', width: 14 },
        { header: 'Vắng mặt', key: 'absentDays', width: 11 },
        { header: 'Nghỉ phép (tổng)', key: 'leaveDays', width: 15 },
        { header: 'Phép năm', key: 'annualLeave', width: 10 },
        { header: 'Nghỉ ốm', key: 'sickLeave', width: 10 },
        { header: 'Không lương', key: 'unpaidLeave', width: 12 },
        { header: 'Giờ làm (h)', key: 'totalWorkHours', width: 12 },
        { header: 'Đi muộn (lần)', key: 'totalLateCount', width: 13 },
        { header: 'Đi muộn (phút)', key: 'totalLateMinutes', width: 14 },
        { header: 'Về sớm (lần)', key: 'earlyLeaveCount', width: 12 },
        { header: 'OT duyệt (h)', key: 'approvedOtHours', width: 12 },
        { header: 'OT chưa duyệt (h)', key: 'unapprovedOtHours', width: 14 }
    ];
    summarySheet.columns = summaryColumns.map(({ key, width }) => ({ key, width }));

    const title = formatReportTitle(month);
    const subtitle = await resolveSubtitle(scope, teamId, summary);
    summarySheet.mergeCells(1, 1, 1, summaryColumns.length);
    summarySheet.getCell(1, 1).value = title;
    summarySheet.getRow(1).font = { bold: true, size: 14 };
    summarySheet.getRow(1).alignment = { horizontal: 'center', vertical: 'middle' };

    summarySheet.mergeCells(2, 1, 2, summaryColumns.length);
    summarySheet.getCell(2, 1).value = subtitle;
    summarySheet.getRow(2).font = { italic: true };
    summarySheet.getRow(2).alignment = { horizontal: 'center', vertical: 'middle' };

    const headerRow = summarySheet.getRow(3);
    summaryColumns.forEach((column, index) => {
        headerRow.getCell(index + 1).value = column.header;
    });
    headerRow.font = { bold: true };
    headerRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE0E0E0' }
    };
    headerRow.alignment = { horizontal: 'center', vertical: 'middle' };

    for (const item of summary) {
        summarySheet.addRow({
            employeeCode: sanitizeForExcel(item?.user?.employeeCode),
            name: sanitizeForExcel(item?.user?.name),
            teamName: sanitizeForExcel(item?.user?.teamName),
            totalWorkdays: item?.totalWorkdays ?? 0,
            presentDays: item?.presentDays ?? 0,
            unregisteredDays: item?.unregisteredDays ?? 0,
            absentDays: item?.absentDays ?? 0,
            leaveDays: item?.leaveDays ?? 0,
            annualLeave: item?.leaveByType?.ANNUAL ?? 0,
            sickLeave: item?.leaveByType?.SICK ?? 0,
            unpaidLeave: item?.leaveByType?.UNPAID ?? 0,
            totalWorkHours: toHours(item?.totalWorkMinutes),
            totalLateCount: item?.totalLateCount ?? 0,
            totalLateMinutes: item?.totalLateMinutes ?? 0,
            earlyLeaveCount: item?.earlyLeaveCount ?? 0,
            approvedOtHours: toHours(item?.approvedOtMinutes),
            unapprovedOtHours: toHours(item?.unapprovedOtMinutes)
        });
    }

    const totals = summary.reduce((acc, item) => {
        acc.totalWorkdays += item?.totalWorkdays ?? 0;
        acc.presentDays += item?.presentDays ?? 0;
        acc.unregisteredDays += item?.unregisteredDays ?? 0;
        acc.absentDays += item?.absentDays ?? 0;
        acc.leaveDays += item?.leaveDays ?? 0;
        acc.annualLeave += item?.leaveByType?.ANNUAL ?? 0;
        acc.sickLeave += item?.leaveByType?.SICK ?? 0;
        acc.unpaidLeave += item?.leaveByType?.UNPAID ?? 0;
        acc.totalWorkMinutes += item?.totalWorkMinutes ?? 0;
        acc.totalLateCount += item?.totalLateCount ?? 0;
        acc.totalLateMinutes += item?.totalLateMinutes ?? 0;
        acc.earlyLeaveCount += item?.earlyLeaveCount ?? 0;
        acc.approvedOtMinutes += item?.approvedOtMinutes ?? 0;
        acc.unapprovedOtMinutes += item?.unapprovedOtMinutes ?? 0;
        return acc;
    }, {
        totalWorkdays: 0,
        presentDays: 0,
        unregisteredDays: 0,
        absentDays: 0,
        leaveDays: 0,
        annualLeave: 0,
        sickLeave: 0,
        unpaidLeave: 0,
        totalWorkMinutes: 0,
        totalLateCount: 0,
        totalLateMinutes: 0,
        earlyLeaveCount: 0,
        approvedOtMinutes: 0,
        unapprovedOtMinutes: 0
    });

    const summaryRow = summarySheet.addRow({
        employeeCode: 'TỔNG',
        totalWorkdays: totals.totalWorkdays,
        presentDays: totals.presentDays,
        unregisteredDays: totals.unregisteredDays,
        absentDays: totals.absentDays,
        leaveDays: totals.leaveDays,
        annualLeave: totals.annualLeave,
        sickLeave: totals.sickLeave,
        unpaidLeave: totals.unpaidLeave,
        totalWorkHours: toHours(totals.totalWorkMinutes),
        totalLateCount: totals.totalLateCount,
        totalLateMinutes: totals.totalLateMinutes,
        earlyLeaveCount: totals.earlyLeaveCount,
        approvedOtHours: toHours(totals.approvedOtMinutes),
        unapprovedOtHours: toHours(totals.unapprovedOtMinutes)
    });
    summaryRow.font = { bold: true };
    summaryRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFF2F2F2' }
    };

    ['totalWorkHours', 'approvedOtHours', 'unapprovedOtHours'].forEach((columnKey) => {
        summarySheet.getColumn(columnKey).numFmt = '0.0';
    });

    setCellBorders(summarySheet, 3);

    const lateSheet = workbook.addWorksheet('Chi tiết đi muộn');
    lateSheet.columns = [
        { header: 'Mã NV', key: 'employeeCode', width: 14 },
        { header: 'Tên NV', key: 'name', width: 24 },
        { header: 'Ngày', key: 'date', width: 10 },
        { header: 'Giờ vào', key: 'checkInTime', width: 10 },
        { header: 'Muộn (phút)', key: 'lateMinutes', width: 12 }
    ];
    lateSheet.getRow(1).font = { bold: true };
    lateSheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE0E0E0' }
    };

    const lateRows = [];
    for (const item of summary) {
        const details = Array.isArray(item?.lateDetails) ? item.lateDetails : [];
        for (const detail of details) {
            lateRows.push({
                employeeCode: sanitizeForExcel(item?.user?.employeeCode),
                name: sanitizeForExcel(item?.user?.name),
                date: detail?.date || '',
                checkInTime: detail?.checkInTime || '',
                lateMinutes: detail?.lateMinutes ?? 0
            });
        }
    }

    lateRows.sort((a, b) =>
        a.date.localeCompare(b.date) ||
        a.employeeCode.localeCompare(b.employeeCode) ||
        a.checkInTime.localeCompare(b.checkInTime)
    );

    for (const lateRow of lateRows) {
        lateSheet.addRow({
            employeeCode: lateRow.employeeCode,
            name: lateRow.name,
            date: toDateLabel(lateRow.date),
            checkInTime: lateRow.checkInTime,
            lateMinutes: lateRow.lateMinutes
        });
    }

    const lateSummaryRow = lateSheet.addRow({
        employeeCode: `TỔNG: ${lateRows.length} lượt đi muộn`
    });
    lateSheet.mergeCells(lateSummaryRow.number, 1, lateSummaryRow.number, 5);
    lateSummaryRow.font = { bold: true };
    lateSummaryRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFF2F2F2' }
    };

    setCellBorders(lateSheet, 1);

    // Keep numeric columns right-aligned for readability
    [
        'totalWorkdays',
        'presentDays',
        'unregisteredDays',
        'absentDays',
        'leaveDays',
        'annualLeave',
        'sickLeave',
        'unpaidLeave',
        'totalWorkHours',
        'totalLateCount',
        'totalLateMinutes',
        'earlyLeaveCount',
        'approvedOtHours',
        'unapprovedOtHours'
    ].forEach((columnKey) => {
        summarySheet.getColumn(columnKey).alignment = { horizontal: 'right' };
    });

    ['lateMinutes'].forEach((columnKey) => {
        lateSheet.getColumn(columnKey).alignment = { horizontal: 'right' };
    });

    // Preserve formula-injection protection on textual summary rows
    summarySheet.eachRow((row) => {
        row.eachCell((cell) => {
            if (typeof cell.value === 'string') {
                cell.value = sanitizeForExcel(cell.value);
            }
        });
    });
    lateSheet.eachRow((row) => {
        row.eachCell((cell) => {
            if (typeof cell.value === 'string') {
                cell.value = sanitizeForExcel(cell.value);
            }
        });
    });

    // Add simple autofilter on both headers
    summarySheet.autoFilter = {
        from: { row: 3, column: 1 },
        to: { row: 3, column: summaryColumns.length }
    };
    lateSheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: 5 }
    };

    // Add freeze panes for readability
    summarySheet.views = [{ state: 'frozen', ySplit: 3 }];
    lateSheet.views = [{ state: 'frozen', ySplit: 1 }];

    // Generate buffer and normalize to Buffer type
    const rawBuffer = await workbook.xlsx.writeBuffer();
    const buffer = Buffer.isBuffer(rawBuffer) ? rawBuffer : Buffer.from(rawBuffer);

    return buffer;
};
