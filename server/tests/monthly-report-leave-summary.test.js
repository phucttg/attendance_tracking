import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import bcrypt from 'bcrypt';
import Request from '../src/models/Request.js';
import Team from '../src/models/Team.js';
import User from '../src/models/User.js';
import { getMonthlyReport } from '../src/services/reportService.js';

const testEmailPattern = /@report-leave-summary\.test$/;
const testTeamPattern = /^Report Leave Summary/;

const cleanupReportLeaveSummaryData = async () => {
  const users = await User.find({ email: testEmailPattern }).select('_id').lean();
  const userIds = users.map((user) => user._id);

  await Request.deleteMany({ userId: { $in: userIds } });
  await User.deleteMany({ email: testEmailPattern });
  await Team.deleteMany({ name: testTeamPattern });
};

describe('Monthly report leave summary', () => {
  beforeEach(async () => {
    await cleanupReportLeaveSummaryData();
  });

  afterEach(async () => {
    await cleanupReportLeaveSummaryData();
  });

  it('returns total leave days without leave type breakdown', async () => {
    const team = await Team.create({ name: 'Report Leave Summary Team' });
    const passwordHash = await bcrypt.hash('Password123', 8);
    const user = await User.create({
      employeeCode: 'REPORT-LEAVE-001',
      name: 'Report Leave User',
      email: 'employee@report-leave-summary.test',
      passwordHash,
      role: 'EMPLOYEE',
      teamId: team._id,
      isActive: true,
      deletedAt: null
    });

    await Request.create({
      userId: user._id,
      type: 'LEAVE',
      leaveStartDate: '2026-05-12',
      leaveEndDate: '2026-05-13',
      leaveType: 'SICK',
      status: 'APPROVED',
      reason: 'legacy leave type should not appear in report'
    });

    const report = await getMonthlyReport('team', '2026-05', team._id.toString(), new Set());

    expect(report.summary).toHaveLength(1);
    expect(report.summary[0].leaveDays).toBe(2);
    expect(report.summary[0]).not.toHaveProperty('leaveByType');
  });
});
