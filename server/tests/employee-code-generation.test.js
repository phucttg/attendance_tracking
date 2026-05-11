import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import User from '../src/models/User.js';
import { JWT_SECRET } from '../src/config/jwt.js';

const password = 'Password123';
const authAdminCode = 'EMPLOYEE-CODE-AUTH';
const testEmailPattern = /@employee-code\.test$/;
const generatedCodePattern = /^(ADM|MNG|EMP)\d{3,}$/;

const cleanupEmployeeCodeUsers = () =>
  User.deleteMany({
    $or: [
      { email: testEmailPattern },
      { username: /^employee-code-/ },
      { employeeCode: authAdminCode },
      { employeeCode: generatedCodePattern }
    ]
  });

async function createDirectUser({
  employeeCode,
  role = 'EMPLOYEE',
  email,
  username,
  deletedAt = null
}) {
  const passwordHash = await bcrypt.hash(password, 8);
  return User.create({
    employeeCode,
    name: `${role} ${employeeCode}`,
    email: email || `${employeeCode.toLowerCase()}@employee-code.test`,
    username,
    passwordHash,
    role,
    isActive: true,
    deletedAt
  });
}

async function createTokenForRole(role, overrides = {}) {
  const suffix = role.toLowerCase();
  const user = await createDirectUser({
    employeeCode: role === 'ADMIN' ? authAdminCode : `EMPLOYEE-CODE-${role}`,
    role,
    email: `${suffix}@employee-code.test`,
    username: `employee-code-${suffix}`,
    ...overrides
  });

  return jwt.sign(
    { userId: user._id.toString(), role: user.role },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
}

async function createAdminToken() {
  return createTokenForRole('ADMIN');
}

function createUserPayload(overrides = {}) {
  return {
    employeeCode: 'EMP001',
    name: 'Generated Employee',
    email: 'new-user@employee-code.test',
    password,
    role: 'EMPLOYEE',
    isActive: true,
    ...overrides
  };
}

describe('Employee code generation', () => {
  let adminToken;

  beforeEach(async () => {
    await cleanupEmployeeCodeUsers();
    adminToken = await createAdminToken();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupEmployeeCodeUsers();
  });

  describe('API access control', () => {
    it('requires authentication for next employee code', async () => {
      const res = await request(app)
        .get('/api/admin/users/next-employee-code')
        .query({ role: 'EMPLOYEE' })
        .expect(401);

      expect(res.body).toEqual({ message: 'Authentication required' });
    });

    it('denies EMPLOYEE and MANAGER tokens for next employee code', async () => {
      const employeeToken = await createTokenForRole('EMPLOYEE');
      const managerToken = await createTokenForRole('MANAGER');

      await request(app)
        .get('/api/admin/users/next-employee-code')
        .query({ role: 'EMPLOYEE' })
        .set('Authorization', `Bearer ${employeeToken}`)
        .expect(403);

      await request(app)
        .get('/api/admin/users/next-employee-code')
        .query({ role: 'EMPLOYEE' })
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(403);
    });

    it('returns only the generated employeeCode field for admins', async () => {
      const res = await request(app)
        .get('/api/admin/users/next-employee-code')
        .query({ role: 'EMPLOYEE' })
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body).toEqual({ employeeCode: 'EMP001' });
      expect(Object.keys(res.body)).toEqual(['employeeCode']);
    });
  });

  it('returns the first code for each role when no matching generated code exists', async () => {
    const employeeRes = await request(app)
      .get('/api/admin/users/next-employee-code')
      .query({ role: 'EMPLOYEE' })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const managerRes = await request(app)
      .get('/api/admin/users/next-employee-code')
      .query({ role: 'MANAGER' })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const adminRes = await request(app)
      .get('/api/admin/users/next-employee-code')
      .query({ role: 'ADMIN' })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(employeeRes.body).toEqual({ employeeCode: 'EMP001' });
    expect(managerRes.body).toEqual({ employeeCode: 'MNG001' });
    expect(adminRes.body).toEqual({ employeeCode: 'ADM001' });
  });

  it('uses the largest matching suffix and ignores legacy codes', async () => {
    await createDirectUser({ employeeCode: 'EMP001', role: 'EMPLOYEE' });
    await createDirectUser({ employeeCode: 'EMP002', role: 'EMPLOYEE' });
    await createDirectUser({ employeeCode: 'EMP006', role: 'EMPLOYEE' });
    await createDirectUser({ employeeCode: 'NV001', role: 'EMPLOYEE' });
    await createDirectUser({ employeeCode: 'AUTH-PROFILE-001', role: 'EMPLOYEE' });
    await createDirectUser({ employeeCode: 'MGR001', role: 'MANAGER' });

    const employeeRes = await request(app)
      .get('/api/admin/users/next-employee-code')
      .query({ role: 'EMPLOYEE' })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const managerRes = await request(app)
      .get('/api/admin/users/next-employee-code')
      .query({ role: 'MANAGER' })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(employeeRes.body).toEqual({ employeeCode: 'EMP007' });
    expect(managerRes.body).toEqual({ employeeCode: 'MNG001' });
  });

  it('keeps role counters isolated from other generated prefixes', async () => {
    await createDirectUser({ employeeCode: 'ADM010', role: 'ADMIN' });
    await createDirectUser({ employeeCode: 'EMP010', role: 'EMPLOYEE' });

    const employeeRes = await request(app)
      .get('/api/admin/users/next-employee-code')
      .query({ role: 'EMPLOYEE' })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const managerRes = await request(app)
      .get('/api/admin/users/next-employee-code')
      .query({ role: 'MANAGER' })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(employeeRes.body).toEqual({ employeeCode: 'EMP011' });
    expect(managerRes.body).toEqual({ employeeCode: 'MNG001' });
  });

  it('pads to at least 3 digits and crosses from 099 to 100', async () => {
    await createDirectUser({ employeeCode: 'EMP099', role: 'EMPLOYEE' });

    const res = await request(app)
      .get('/api/admin/users/next-employee-code')
      .query({ role: 'EMPLOYEE' })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body).toEqual({ employeeCode: 'EMP100' });
  });

  it('counts soft-deleted users and allows suffixes beyond 999', async () => {
    await createDirectUser({
      employeeCode: 'EMP999',
      role: 'EMPLOYEE',
      deletedAt: new Date()
    });

    const res = await request(app)
      .get('/api/admin/users/next-employee-code')
      .query({ role: 'EMPLOYEE' })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body).toEqual({ employeeCode: 'EMP1000' });
  });

  it('rejects invalid roles for next employee code', async () => {
    const res = await request(app)
      .get('/api/admin/users/next-employee-code')
      .query({ role: 'INTERN' })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);

    expect(res.body.message).toMatch(/invalid role/i);
  });

  it('rejects missing role for next employee code', async () => {
    const res = await request(app)
      .get('/api/admin/users/next-employee-code')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);

    expect(res.body.message).toMatch(/role is required/i);
  });

  it('rejects create user when employee code is missing', async () => {
    const { employeeCode, ...payload } = createUserPayload();

    expect(employeeCode).toBe('EMP001');

    const res = await request(app)
      .post('/api/admin/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(payload)
      .expect(400);

    expect(res.body.message).toMatch(/employee code is required/i);
  });

  it.each([
    ['EMPLOYEE', 'MNG001'],
    ['MANAGER', 'EMP001'],
    ['ADMIN', 'EMP001']
  ])('rejects create user when %s code prefix does not match role', async (role, employeeCode) => {
    const res = await request(app)
      .post('/api/admin/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(createUserPayload({ employeeCode, role }))
      .expect(400);

    expect(res.body.message).toMatch(new RegExp(`employee code for ${role}`, 'i'));
  });

  it.each(['EMP01', 'EMPABC', 'EMP001X', 'emp001'])(
    'rejects create user when employee code format is invalid: %s',
    async (employeeCode) => {
      const res = await request(app)
        .post('/api/admin/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(createUserPayload({ employeeCode }))
        .expect(400);

      expect(res.body.message).toMatch(/employee code for employee/i);
    }
  );

  it('uses the current next code even when the submitted code is stale', async () => {
    await createDirectUser({
      employeeCode: 'EMP001',
      role: 'EMPLOYEE',
      email: 'existing-emp001@employee-code.test'
    });

    const res = await request(app)
      .post('/api/admin/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(createUserPayload({ employeeCode: 'EMP001', email: 'retry-success@employee-code.test' }))
      .expect(201);

    expect(res.body.user.employeeCode).toBe('EMP002');
    await expect(User.findOne({ employeeCode: 'EMP002' }).lean()).resolves.toMatchObject({
      email: 'retry-success@employee-code.test'
    });
  });

  it('ignores arbitrary valid-looking future codes and uses the current next code', async () => {
    await createDirectUser({
      employeeCode: 'EMP001',
      role: 'EMPLOYEE',
      email: 'existing-emp001@employee-code.test'
    });

    const res = await request(app)
      .post('/api/admin/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(createUserPayload({ employeeCode: 'EMP999', email: 'future-code@employee-code.test' }))
      .expect(201);

    expect(res.body.user.employeeCode).toBe('EMP002');
    await expect(User.findOne({ employeeCode: 'EMP999' }).lean()).resolves.toBeNull();
  });

  it('does not expose sensitive fields in create user responses', async () => {
    const res = await request(app)
      .post('/api/admin/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(createUserPayload({ email: 'safe-response@employee-code.test' }))
      .expect(201);

    expect(res.body.user).toMatchObject({
      employeeCode: 'EMP001',
      email: 'safe-response@employee-code.test',
      role: 'EMPLOYEE'
    });
    expect(res.body.user).not.toHaveProperty('passwordHash');
    expect(res.body.user).not.toHaveProperty('__v');
    expect(res.body.user).not.toHaveProperty('token');
    expect(res.body.user).not.toHaveProperty('tokens');
  });

  it('retries with a freshly generated code when insert races on employeeCode', async () => {
    await createDirectUser({
      employeeCode: 'EMP001',
      role: 'EMPLOYEE',
      email: 'existing-emp001@employee-code.test'
    });

    const duplicateEmployeeCodeError = new Error('Duplicate employee code');
    duplicateEmployeeCodeError.code = 11000;
    duplicateEmployeeCodeError.keyPattern = { employeeCode: 1 };

    const actualCreate = User.create.bind(User);
    vi.spyOn(User, 'create')
      .mockRejectedValueOnce(duplicateEmployeeCodeError)
      .mockImplementation((doc) => actualCreate(doc));

    const res = await request(app)
      .post('/api/admin/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(createUserPayload({ employeeCode: 'EMP001', email: 'race-success@employee-code.test' }))
      .expect(201);

    expect(res.body.user.employeeCode).toBe('EMP002');
    await expect(User.findOne({ employeeCode: 'EMP002' }).lean()).resolves.toMatchObject({
      email: 'race-success@employee-code.test'
    });
  });

  it('does not retry duplicate email errors', async () => {
    await createDirectUser({
      employeeCode: 'EMP001',
      role: 'EMPLOYEE',
      email: 'duplicate@employee-code.test'
    });

    const res = await request(app)
      .post('/api/admin/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(createUserPayload({
        employeeCode: 'EMP002',
        email: 'duplicate@employee-code.test'
      }))
      .expect(409);

    expect(res.body.message).toBe('Email already exists');
    await expect(User.findOne({ employeeCode: 'EMP003' }).lean()).resolves.toBeNull();
  });

  it('does not retry duplicate username errors', async () => {
    await createDirectUser({
      employeeCode: 'EMP001',
      role: 'EMPLOYEE',
      email: 'existing-username@employee-code.test',
      username: 'employee-code-duplicate'
    });

    const res = await request(app)
      .post('/api/admin/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(createUserPayload({
        employeeCode: 'EMP002',
        email: 'duplicate-username@employee-code.test',
        username: 'employee-code-duplicate'
      }))
      .expect(409);

    expect(res.body.message).toBe('Username already exists');
    await expect(User.findOne({ employeeCode: 'EMP003' }).lean()).resolves.toBeNull();
  });

  it('returns a clear 409 after exhausting employeeCode duplicate retries', async () => {
    const duplicateEmployeeCodeError = new Error('Duplicate employee code');
    duplicateEmployeeCodeError.code = 11000;
    duplicateEmployeeCodeError.keyPattern = { employeeCode: 1 };

    const createSpy = vi.spyOn(User, 'create')
      .mockRejectedValue(duplicateEmployeeCodeError);

    const res = await request(app)
      .post('/api/admin/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(createUserPayload({ email: 'retry-exhausted@employee-code.test' }))
      .expect(409);

    expect(createSpy).toHaveBeenCalledTimes(4);
    expect(res.body.message).toMatch(/refresh the employee code/i);
  });
});
