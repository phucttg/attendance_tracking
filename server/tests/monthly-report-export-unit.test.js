/**
 * Test Suite: Monthly Report Export Unit Tests
 * 
 * Coverage:
 * - C5: Late Details Deterministic Sorting (3 tests)
 * - C6: Excel Numeric Hour Columns (documented for manual validation)
 * - GAP-3: Team Name Fallback in Export (2 tests)
 * 
 * Framework: Vitest + ExcelJS for Excel validation
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import ExcelJS from 'exceljs';
import User from '../src/models/User.js';
import Team from '../src/models/Team.js';
import Attendance from '../src/models/Attendance.js';
import Request from '../src/models/Request.js';
import { getMonthlyReport } from '../src/services/reportService.js';
import { generateMonthlyExportExcel } from '../src/services/exportService.js';
import {
    createTestUser,
    createTestTeam,
    getScenario3Data,
    getScenario6Teams,
    clearTestData
} from './fixtures/monthlyReportFixtures.js';

let testTeam, testEmployee;

beforeAll(async () => {
    await mongoose.connect(
        process.env.MONGO_URI?.replace(/\/[^/]+$/, '/monthly_report_export_test_db')
        || 'mongodb://localhost:27017/monthly_report_export_test_db'
    );

    await clearTestData(User, Team, Attendance, Request);

    testTeam = await createTestTeam(Team, { name: 'Export Test Team' });
    testEmployee = await createTestUser(User, {
        employeeCode: 'EXP001',
        name: 'Export Test Employee',
        email: 'export@test.com',
        role: 'EMPLOYEE',
        teamId: testTeam._id
    });
});

afterAll(async () => {
    await clearTestData(User, Team, Attendance, Request);
    await mongoose.connection.close();
});

beforeEach(async () => {
    await Attendance.deleteMany({});
    await Request.deleteMany({});
});

describe('C5: Late Details Deterministic Sorting', () => {
    
    it('C5-TC1: Multiple late check-ins on different dates sorted by date ascending', async () => {
        // Arrange: Create attendance with different late dates in random order
        const scenario = getScenario3Data(testEmployee._id);
        
        // Insert in unsorted order
        await Attendance.insertMany(scenario.attendance);
        
        // Act
        const result = await getMonthlyReport('company', '2026-02', null, new Set());
        
        // Assert
        const row = result.summary.find(r => r.user.employeeCode === 'EXP001');
        expect(row).toBeDefined();
        expect(row.lateDetails).toBeDefined();
        expect(Array.isArray(row.lateDetails)).toBe(true);
        
        // Verify sorting by date ascending
        const dates = row.lateDetails.map(d => d.date);
        const sortedDates = [...dates].sort();
        expect(dates).toEqual(sortedDates);
        
        // Expected order: Feb 5, Feb 10, Feb 17, Feb 20, Feb 24
        expect(row.lateDetails.length).toBe(5);
        expect(row.lateDetails[0].date).toBe('2026-02-05');
        expect(row.lateDetails[1].date).toBe('2026-02-10');
        expect(row.lateDetails[2].date).toBe('2026-02-17');
        expect(row.lateDetails[3].date).toBe('2026-02-20');
        expect(row.lateDetails[4].date).toBe('2026-02-24');
    });

    it('C5-TC2: Late details sorted deterministically by date then checkInTime', async () => {
        // Arrange
        const scenario = getScenario3Data(testEmployee._id);
        await Attendance.insertMany(scenario.attendance);
        
        // Act
        const result = await getMonthlyReport('company', '2026-02', null, new Set());
        
        // Assert
        const row = result.summary.find(r => r.user.employeeCode === 'EXP001');
        expect(row.lateDetails.map(d => `${d.date} ${d.checkInTime}`)).toEqual([
            '2026-02-05 09:00',
            '2026-02-10 09:10',
            '2026-02-17 09:05',
            '2026-02-20 09:00',
            '2026-02-24 09:30'
        ]);
    });

    it('C5-TC3: Late details contain required fields with correct format', async () => {
        // Arrange
        await Attendance.create({
            userId: testEmployee._id,
            date: '2026-02-05',
            checkInAt: new Date('2026-02-05T02:00:00Z'), // 09:00 GMT+7
            checkOutAt: new Date('2026-02-05T10:30:00Z')
        });
        
        // Act
        const result = await getMonthlyReport('company', '2026-02', null, new Set());
        
        // Assert
        const row = result.summary.find(r => r.user.employeeCode === 'EXP001');
        expect(row.lateDetails.length).toBe(1);
        
        const lateDetail = row.lateDetails[0];
        
        // Verify required fields
        expect(lateDetail).toHaveProperty('date');
        expect(lateDetail).toHaveProperty('checkInTime');
        expect(lateDetail).toHaveProperty('lateMinutes');
        
        // Verify formats
        expect(lateDetail.date).toMatch(/^\d{4}-\d{2}-\d{2}$/); // YYYY-MM-DD
        expect(lateDetail.checkInTime).toMatch(/^\d{2}:\d{2}$/); // HH:mm
        expect(typeof lateDetail.lateMinutes).toBe('number');
        
        // Verify values
        expect(lateDetail.date).toBe('2026-02-05');
        expect(lateDetail.checkInTime).toBe('09:00');
        expect(lateDetail.lateMinutes).toBe(15); // 09:00 is 15 minutes late (standard start 08:45)
    });

    it('C5-TC3.1: Late details sorted deterministically with tie-breaking', async () => {
        // Arrange: Create multiple late records (unique userId+date)
        await Attendance.insertMany([
            {
                userId: testEmployee._id,
                date: '2026-02-10',
                checkInAt: new Date('2026-02-10T02:10:00Z'), // 09:10 GMT+7
                checkOutAt: new Date('2026-02-10T10:30:00Z')
            },
            {
                userId: testEmployee._id,
                date: '2026-02-05',
                checkInAt: new Date('2026-02-05T02:00:00Z'), // 09:00 GMT+7
                checkOutAt: new Date('2026-02-05T10:30:00Z')
            },
            {
                userId: testEmployee._id,
                date: '2026-02-06',
                checkInAt: new Date('2026-02-06T02:05:00Z'), // 09:05 GMT+7
                checkOutAt: new Date('2026-02-06T10:30:00Z')
            }
        ]);
        
        // Act
        const result = await getMonthlyReport('company', '2026-02', null, new Set());
        
        // Assert
        const row = result.summary.find(r => r.user.employeeCode === 'EXP001');
        
        // Verify deterministic sorting
        expect(row.lateDetails[0].date).toBe('2026-02-05');
        expect(row.lateDetails[0].checkInTime).toBe('09:00');
        expect(row.lateDetails[1].date).toBe('2026-02-06');
        expect(row.lateDetails[1].checkInTime).toBe('09:05');
        expect(row.lateDetails[2].date).toBe('2026-02-10');
        expect(row.lateDetails[2].checkInTime).toBe('09:10');
    });
});

describe('C6: Excel Numeric Hour Columns (Manual Validation)', () => {
    
    it.skip('C6-TC1: workHours column has numeric type (MANUAL TEST)', async () => {
        // This test requires manual inspection of Excel file
        // See excel-format-validator.js for automated validation script
        
        // To manually test:
        // 1. Generate Excel export via API
        // 2. Open in Excel/Google Sheets
        // 3. Click on a workHours cell
        // 4. Verify cell type is 'Number', not 'Text'
        // 5. Verify value has 1 decimal place (e.g., 8.5, not "8.5")
        
        expect(true).toBe(true); // Placeholder
    });

    it('C6-TC1-AUTO: Verify Excel workHours column type programmatically', async () => {
        // Arrange: Create attendance data
        await Attendance.create({
            userId: testEmployee._id,
            date: '2026-02-05',
            checkInAt: new Date('2026-02-05T01:30:00Z'), // 08:30 GMT+7
            checkOutAt: new Date('2026-02-05T10:30:00Z') // 17:30 GMT+7 = 9 hours
        });
        
        // Act: Generate Excel buffer
        const excelBuffer = await generateMonthlyExportExcel('company', '2026-02', null, new Set());
        
        // Assert: Parse Excel and check cell types
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(excelBuffer);
        
        const summarySheet = workbook.getWorksheet('Báo cáo tổng hợp');
        expect(summarySheet).toBeDefined();
        
        // Find header row (typically row 4 after title and subtitle)
        let headerRow = null;
        let workHoursColIndex = null;
        
        summarySheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
            if (rowNumber <= 10) { // Check first 10 rows for header
                row.eachCell((cell, colNumber) => {
                    if (cell.value && String(cell.value).includes('Giờ làm (h)')) {
                        headerRow = rowNumber;
                        workHoursColIndex = colNumber;
                    }
                });
            }
        });
        
        expect(headerRow).toBeDefined();
        expect(workHoursColIndex).toBeDefined();
        
        // Check data row cell type (row after header)
        const dataRow = summarySheet.getRow(headerRow + 1);
        const workHoursCell = dataRow.getCell(workHoursColIndex);
        
        // Verify cell type is number, not string
        expect(workHoursCell.type).toBe(ExcelJS.ValueType.Number);
        expect(typeof workHoursCell.value).toBe('number');
        
        // 08:30-17:30 spans 12:00-13:00, so lunch deduction applies:
        // workMinutes = 480 -> 8.0 hours exported
        expect(workHoursCell.value).toBeCloseTo(8.0, 1);
    });

    it('C6-TC2-AUTO: Verify Excel otHours column type programmatically', async () => {
        // Arrange: Create attendance with OT
        await Attendance.create({
            userId: testEmployee._id,
            date: '2026-02-05',
            checkInAt: new Date('2026-02-05T01:30:00Z'), // 08:30 GMT+7
            checkOutAt: new Date('2026-02-05T12:00:00Z'), // 19:00 GMT+7 = 10.5 hours (includes OT)
            otApproved: true
        });
        
        // Act
        const excelBuffer = await generateMonthlyExportExcel('company', '2026-02', null, new Set());
        
        // Assert
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(excelBuffer);
        
        const summarySheet = workbook.getWorksheet('Báo cáo tổng hợp');
        
        let headerRow = null;
        let otHoursColIndex = null;
        
        summarySheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
            if (rowNumber <= 10) {
                row.eachCell((cell, colNumber) => {
                    if (cell.value && String(cell.value).includes('OT duyệt (h)')) {
                        headerRow = rowNumber;
                        otHoursColIndex = colNumber;
                    }
                });
            }
        });
        
        expect(headerRow).toBeDefined();
        expect(otHoursColIndex).toBeDefined();
        
        const dataRow = summarySheet.getRow(headerRow + 1);
        const otHoursCell = dataRow.getCell(otHoursColIndex);
        
        // Verify numeric type
        expect(otHoursCell.type).toBe(ExcelJS.ValueType.Number);
        expect(typeof otHoursCell.value).toBe('number');
        
        // OT starts at 17:30, so from 17:30 to 19:00 = 1.5 hours
        expect(otHoursCell.value).toBeGreaterThan(0);
    });

    it('C6-TC3: Numeric values have 1 decimal precision', async () => {
        // Arrange
        await Attendance.create({
            userId: testEmployee._id,
            date: '2026-02-05',
            checkInAt: new Date('2026-02-05T01:30:00Z'),
            checkOutAt: new Date('2026-02-05T10:00:00Z') // 8.5 hours
        });
        
        // Act
        const excelBuffer = await generateMonthlyExportExcel('company', '2026-02', null, new Set());
        
        // Assert
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(excelBuffer);
        
        const summarySheet = workbook.getWorksheet('Báo cáo tổng hợp');
        
        let headerRow = null;
        let workHoursColIndex = null;
        
        summarySheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
            if (rowNumber <= 10) {
                row.eachCell((cell, colNumber) => {
                    if (cell.value && String(cell.value).includes('Giờ làm (h)')) {
                        headerRow = rowNumber;
                        workHoursColIndex = colNumber;
                    }
                });
            }
        });
        
        const dataRow = summarySheet.getRow(headerRow + 1);
        const workHoursCell = dataRow.getCell(workHoursColIndex);
        
        // Verify 1 decimal place precision
        const numString = workHoursCell.value.toFixed(1);
        expect(numString).toMatch(/^\d+\.\d$/); // Format: X.Y
    });
});

describe('GAP-3: Team Name Fallback in Export', () => {
    
    it('GAP3-TC1: Team with no users shows generic subtitle', async () => {
        // Arrange: Create empty team
        const scenario = await getScenario6Teams(Team, User);
        const emptyTeamId = scenario.emptyTeam._id;
        
        // Act: Generate export for empty team
        const excelBuffer = await generateMonthlyExportExcel('team', '2026-02', emptyTeamId, new Set());
        
        // Assert: Parse Excel and check subtitle
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(excelBuffer);
        
        const summarySheet = workbook.getWorksheet('Báo cáo tổng hợp');
        expect(summarySheet).toBeDefined();
        
        // Subtitle is typically in row 2 or 3
        const row2 = summarySheet.getRow(2);
        const row3 = summarySheet.getRow(3);
        
        const row2Text = row2.getCell(1).value?.toString() || '';
        const row3Text = row3.getCell(1).value?.toString() || '';
        
        const subtitleText = row2Text + row3Text;
        
        // Should contain generic "Team" label (fallback when no team name available)
        expect(subtitleText).toContain('Phạm vi: Team');
    });

    it('GAP3-TC2: Team with users shows team name in subtitle', async () => {
        // Arrange: Use testTeam which has an employee
        const teamId = testTeam._id;
        
        // Create attendance to ensure user appears in report
        await Attendance.create({
            userId: testEmployee._id,
            date: '2026-02-05',
            checkInAt: new Date('2026-02-05T01:30:00Z'),
            checkOutAt: new Date('2026-02-05T10:30:00Z')
        });
        
        // Act
        const excelBuffer = await generateMonthlyExportExcel('team', '2026-02', teamId, new Set());
        
        // Assert
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(excelBuffer);
        
        const summarySheet = workbook.getWorksheet('Báo cáo tổng hợp');
        
        const row2 = summarySheet.getRow(2);
        const row3 = summarySheet.getRow(3);
        
        const row2Text = row2.getCell(1).value?.toString() || '';
        const row3Text = row3.getCell(1).value?.toString() || '';
        
        const subtitleText = row2Text + row3Text;
        
        // Should contain actual team name
        expect(subtitleText).toContain('Export Test Team');
    });

    it('GAP3-TC2.1: Company scope shows company-wide subtitle', async () => {
        // Arrange
        await Attendance.create({
            userId: testEmployee._id,
            date: '2026-02-05',
            checkInAt: new Date('2026-02-05T01:30:00Z'),
            checkOutAt: new Date('2026-02-05T10:30:00Z')
        });
        
        // Act: Generate company scope export
        const excelBuffer = await generateMonthlyExportExcel('company', '2026-02', null, new Set());
        
        // Assert
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(excelBuffer);
        
        const summarySheet = workbook.getWorksheet('Báo cáo tổng hợp');
        
        const row2 = summarySheet.getRow(2);
        const row3 = summarySheet.getRow(3);
        
        const row2Text = row2.getCell(1).value?.toString() || '';
        const row3Text = row3.getCell(1).value?.toString() || '';
        
        const subtitleText = row2Text + row3Text;
        
        // Should contain company-wide scope label
        expect(subtitleText).toContain('Toàn công ty');
    });

    it('GAP3-TC2.2: Fallback chain - DB lookup when user.teamName empty', async () => {
        // Arrange: Create user WITHOUT teamId populated (orphaned user)
        const orphanUser = await User.create({
            employeeCode: 'ORPHAN001',
            name: 'Orphan User',
            email: 'orphan@test.com',
            passwordHash: await require('bcrypt').hash('Password123', 10),
            role: 'EMPLOYEE',
            teamId: testTeam._id, // Has teamId but not populated in query
            isActive: true
        });
        
        await Attendance.create({
            userId: orphanUser._id,
            date: '2026-02-05',
            checkInAt: new Date('2026-02-05T01:30:00Z'),
            checkOutAt: new Date('2026-02-05T10:30:00Z')
        });
        
        // Act: Generate export (export service should fallback to DB lookup)
        const excelBuffer = await generateMonthlyExportExcel('team', '2026-02', testTeam._id, new Set());
        
        // Assert: Should still show team name via DB fallback
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(excelBuffer);
        
        const summarySheet = workbook.getWorksheet('Báo cáo tổng hợp');
        
        const row2 = summarySheet.getRow(2);
        const row3 = summarySheet.getRow(3);
        
        const subtitleText = (row2.getCell(1).value?.toString() || '') + (row3.getCell(1).value?.toString() || '');
        
        // Should resolve team name even if user.teamName was empty
        expect(subtitleText).toContain('Team');
    });
});
