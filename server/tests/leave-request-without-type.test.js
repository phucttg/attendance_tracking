import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import Attendance from '../src/models/Attendance.js';
import Request from '../src/models/Request.js';
import User from '../src/models/User.js';
import { JWT_SECRET } from '../src/config/jwt.js';

const password = 'Password123';
const testEmailPattern = /@leave-no-type\.test$/;

const cleanupLeaveNoTypeData = async () => {
  const users = await User.find({ email: testEmailPattern }).select('_id').lean();
  const userIds = users.map((user) => user._id);

  await Request.deleteMany({
    $or: [
      { userId: { $in: userIds } },
      { reason: /leave-no-type/i }
    ]
  });
  await Attendance.deleteMany({ userId: { $in: userIds } });
  await User.deleteMany({ email: testEmailPattern });
};

async function createEmployeeAndToken() {
  const passwordHash = await bcrypt.hash(password, 8);
  const user = await User.create({
    employeeCode: 'LEAVE-NO-TYPE-001',
    name: 'Leave No Type User',
    email: 'employee@leave-no-type.test',
    username: 'leave-no-type-user',
    passwordHash,
    role: 'EMPLOYEE',
    isActive: true,
    deletedAt: null
  });

  const token = jwt.sign(
    { userId: user._id.toString(), role: user.role },
    JWT_SECRET,
    { expiresIn: '1h' }
  );

  return { user, token };
}

describe('LEAVE request without leaveType', () => {
  beforeEach(async () => {
    await cleanupLeaveNoTypeData();
  });

  afterEach(async () => {
    await cleanupLeaveNoTypeData();
  });

  it('creates a LEAVE request without leaveType', async () => {
    const { user, token } = await createEmployeeAndToken();

    const res = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'LEAVE',
        leaveStartDate: '2099-03-02',
        leaveEndDate: '2099-03-03',
        reason: 'leave-no-type personal reason'
      })
      .expect(201);

    expect(res.body.request).toMatchObject({
      type: 'LEAVE',
      leaveStartDate: '2099-03-02',
      leaveEndDate: '2099-03-03',
      reason: 'leave-no-type personal reason',
      status: 'PENDING'
    });
    expect(res.body.request.leaveType ?? null).toBeNull();

    const persisted = await Request.findOne({
      userId: user._id,
      type: 'LEAVE',
      leaveStartDate: '2099-03-02'
    }).lean();

    expect(persisted).toMatchObject({
      leaveEndDate: '2099-03-03',
      reason: 'leave-no-type personal reason',
      leaveType: null
    });
  });

  it('rejects LEAVE requests with missing dates, missing reason, or invalid date range', async () => {
    const { token } = await createEmployeeAndToken();

    const missingDatesRes = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'LEAVE',
        reason: 'leave-no-type missing dates'
      })
      .expect(400);

    expect(missingDatesRes.body.message).toMatch(/leaveStartDate and leaveEndDate are required/i);

    const missingReasonRes = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'LEAVE',
        leaveStartDate: '2099-03-02',
        leaveEndDate: '2099-03-03'
      })
      .expect(400);

    expect(missingReasonRes.body.message).toMatch(/reason is required/i);

    const invalidRangeRes = await request(app)
      .post('/api/requests')
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'LEAVE',
        leaveStartDate: '2099-03-05',
        leaveEndDate: '2099-03-04',
        reason: 'leave-no-type invalid range'
      })
      .expect(400);

    expect(invalidRangeRes.body.message).toMatch(/before or equal/i);
  });
});
