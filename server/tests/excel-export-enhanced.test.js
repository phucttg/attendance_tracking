import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import ExcelJS from 'exceljs';
import app from '../src/app.js';
import User from '../src/models/User.js';
import Team from '../src/models/Team.js';
import Attendance from '../src/models/Attendance.js';

let adminToken;
let teamId;
let emptyTeamId;

// Binary parser for Excel responses
function binaryParser(res, callback) {
    res.setEncoding('binary');
    let data = '';
    res.on('data', (chunk) => {
        data += chunk;
    });
    res.on('end', () => {
        callback(null, Buffer.from(data, 'binary'));
    });
}

async function loadWorkbookFromResponseBody(body) {
    const workbook = new ExcelJS.Workbook();
    const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body);
    await workbook.xlsx.load(buffer);
    return workbook;
}

beforeAll(async () => {
    await mongoose.connect(
        process.env.MONGO_URI?.replace(/\/[^/]+$/, '/excel_export_enhanced_test_db')
        || 'mongodb://localhost:27017/excel_export_enhanced_test_db'
    );

    await User.deleteMany({});
    await Team.deleteMany({});
    await Attendance.deleteMany({});

    const reportTeam = await Team.create({ name: 'Excel Enhanced Team' });
    const emptyTeam = await Team.create({ name: 'Empty Export Team' });
    teamId = reportTeam._id;
    emptyTeamId = emptyTeam._id;

    const passwordHash = await bcrypt.hash('Password123', 10);

    await User.create({
        employeeCode: 'XLS001',
        name: 'Excel Admin',
        email: 'excel-enhanced-admin@test.com',
        passwordHash,
        role: 'ADMIN',
        isActive: true
    });

    const employeeA = await User.create({
        employeeCode: 'XLS002',
        name: 'Excel Employee A',
        email: 'excel-enhanced-emp-a@test.com',
        passwordHash,
        role: 'EMPLOYEE',
        teamId,
        isActive: true
    });

    const employeeB = await User.create({
        employeeCode: 'XLS003',
        name: 'Excel Employee B',
        email: 'excel-enhanced-emp-b@test.com',
        passwordHash,
        role: 'EMPLOYEE',
        teamId,
        isActive: true
    });

    await Attendance.create([
        {
            userId: employeeA._id,
            date: '2026-02-10',
            checkInAt: new Date('2026-02-10T02:00:00Z'), // 09:00
            checkOutAt: new Date('2026-02-10T10:30:00Z') // 17:30
        },
        {
            userId: employeeA._id,
            date: '2026-02-03',
            checkInAt: new Date('2026-02-03T02:15:00Z'), // 09:15
            checkOutAt: new Date('2026-02-03T10:30:00Z') // 17:30
        },
        {
            userId: employeeB._id,
            date: '2026-02-05',
            checkInAt: new Date('2026-02-05T02:05:00Z'), // 09:05
            checkOutAt: new Date('2026-02-05T11:30:00Z') // 18:30 (unapproved OT)
        }
    ]);

    const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ identifier: 'excel-enhanced-admin@test.com', password: 'Password123' });
    adminToken = loginRes.body.token;
});

afterAll(async () => {
    await User.deleteMany({});
    await Team.deleteMany({});
    await Attendance.deleteMany({});
    await mongoose.connection.close();
});

describe('Excel Export Enhanced Format', () => {
    it('contains summary sheet with title/subtitle/header and 17 columns', async () => {
        const res = await request(app)
            .get('/api/reports/monthly/export?month=2026-02&scope=company')
            .set('Authorization', `Bearer ${adminToken}`)
            .parse(binaryParser);

        expect(res.status).toBe(200);
        const workbook = await loadWorkbookFromResponseBody(res.body);
        const summarySheet = workbook.getWorksheet('Báo cáo tổng hợp');
        expect(summarySheet).toBeDefined();

        expect(summarySheet.getRow(1).getCell(1).value).toBe('BÁO CÁO CHẤM CÔNG THÁNG 02/2026');
        expect(summarySheet.getRow(2).getCell(1).value).toBe('Phạm vi: Toàn công ty');

        const headers = summarySheet.getRow(3).values.slice(1, 18);
        expect(headers).toEqual([
            'Mã NV',
            'Tên NV',
            'Phòng ban',
            'Ngày công tháng',
            'Có mặt',
            'Chưa đăng ký ca',
            'Vắng mặt',
            'Nghỉ phép (tổng)',
            'Phép năm',
            'Nghỉ ốm',
            'Không lương',
            'Giờ làm (h)',
            'Đi muộn (lần)',
            'Đi muộn (phút)',
            'Về sớm (lần)',
            'OT duyệt (h)',
            'OT chưa duyệt (h)'
        ]);
    });

    it('stores hour columns as numbers with decimal numFmt', async () => {
        const res = await request(app)
            .get('/api/reports/monthly/export?month=2026-02&scope=company')
            .set('Authorization', `Bearer ${adminToken}`)
            .parse(binaryParser);

        expect(res.status).toBe(200);
        const workbook = await loadWorkbookFromResponseBody(res.body);
        const summarySheet = workbook.getWorksheet('Báo cáo tổng hợp');
        expect(summarySheet).toBeDefined();

        expect(summarySheet.getColumn(12).numFmt).toBe('0.0');
        expect(summarySheet.getColumn(16).numFmt).toBe('0.0');
        expect(summarySheet.getColumn(17).numFmt).toBe('0.0');

        // Data rows are between header (row 3) and summary row (last row)
        for (let rowIndex = 4; rowIndex < summarySheet.rowCount; rowIndex += 1) {
            expect(typeof summarySheet.getRow(rowIndex).getCell(12).value).toBe('number');
            expect(typeof summarySheet.getRow(rowIndex).getCell(16).value).toBe('number');
            expect(typeof summarySheet.getRow(rowIndex).getCell(17).value).toBe('number');
        }
    });

    it('contains late-detail sheet sorted by date, employeeCode, checkInTime with summary row', async () => {
        const res = await request(app)
            .get('/api/reports/monthly/export?month=2026-02&scope=company')
            .set('Authorization', `Bearer ${adminToken}`)
            .parse(binaryParser);

        expect(res.status).toBe(200);
        const workbook = await loadWorkbookFromResponseBody(res.body);
        const lateSheet = workbook.getWorksheet('Chi tiết đi muộn');
        expect(lateSheet).toBeDefined();

        const rows = [];
        for (let rowIndex = 2; rowIndex < lateSheet.rowCount; rowIndex += 1) {
            const row = lateSheet.getRow(rowIndex);
            rows.push({
                employeeCode: String(row.getCell(1).value || ''),
                date: String(row.getCell(3).value || ''),
                checkInTime: String(row.getCell(4).value || '')
            });
        }

        const sorted = [...rows].sort((a, b) =>
            a.date.localeCompare(b.date)
            || a.employeeCode.localeCompare(b.employeeCode)
            || a.checkInTime.localeCompare(b.checkInTime)
        );
        expect(rows).toEqual(sorted);

        const summaryCell = String(lateSheet.getRow(lateSheet.rowCount).getCell(1).value || '');
        expect(summaryCell).toMatch(/TỔNG:\s+\d+\s+lượt đi muộn/i);
    });

    it('resolves team subtitle from Team query when team has no members', async () => {
        const res = await request(app)
            .get(`/api/reports/monthly/export?month=2026-02&scope=team&teamId=${emptyTeamId}`)
            .set('Authorization', `Bearer ${adminToken}`)
            .parse(binaryParser);

        expect(res.status).toBe(200);
        const workbook = await loadWorkbookFromResponseBody(res.body);
        const summarySheet = workbook.getWorksheet('Báo cáo tổng hợp');
        expect(summarySheet).toBeDefined();
        expect(summarySheet.getRow(2).getCell(1).value).toBe('Phạm vi: Team: Empty Export Team');
    });
});
