import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import app from '../src/app.js';
import User from '../src/models/User.js';
import { JWT_SECRET } from '../src/config/jwt.js';

const password = 'Password123';
const profileUser = {
  employeeCode: 'AUTH-PROFILE-001',
  name: 'Profile Response User',
  email: 'profile-response@test.com',
  username: 'profile-response',
  role: 'EMPLOYEE',
  startDate: new Date('2026-01-15T00:00:00.000Z')
};

const cleanupProfileUser = () =>
  User.deleteMany({
    $or: [
      { employeeCode: /^AUTH-PROFILE-/ },
      { email: /@auth-profile\.test$/ },
      { username: /^auth-profile-/ },
      { username: profileUser.username }
    ]
  });

async function createProfileUser(overrides = {}) {
  const passwordHash = await bcrypt.hash(password, 8);
  return User.create({
    ...profileUser,
    ...overrides,
    passwordHash,
    isActive: true
  });
}

function expectNoSensitiveUserFields(user) {
  expect(user).not.toHaveProperty('passwordHash');
  expect(user).not.toHaveProperty('deletedAt');
  expect(user).not.toHaveProperty('__v');
  expect(user).not.toHaveProperty('token');
  expect(user).not.toHaveProperty('tokens');
}

describe('Auth profile response', () => {
  beforeEach(async () => {
    await cleanupProfileUser();
  });

  afterEach(async () => {
    await cleanupProfileUser();
  });

  it('POST /api/auth/login returns profile fields needed by /profile', async () => {
    await createProfileUser();

    const res = await request(app)
      .post('/api/auth/login')
      .send({ identifier: profileUser.email, password })
      .expect(200);

    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.user).toMatchObject({
      _id: expect.any(String),
      name: profileUser.name,
      email: profileUser.email,
      username: profileUser.username,
      role: profileUser.role,
      employeeCode: profileUser.employeeCode,
      startDate: profileUser.startDate.toISOString()
    });
    expectNoSensitiveUserFields(res.body.user);
  });

  it('POST /api/auth/login issues a JWT with only minimal auth claims', async () => {
    await createProfileUser();

    const res = await request(app)
      .post('/api/auth/login')
      .send({ identifier: profileUser.email, password })
      .expect(200);

    const decoded = jwt.verify(res.body.token, JWT_SECRET);

    expect(decoded.userId).toBe(String(res.body.user._id));
    expect(decoded.role).toBe(profileUser.role);
    expect(decoded.iat).toEqual(expect.any(Number));
    expect(decoded.exp).toEqual(expect.any(Number));
    expect(Object.keys(decoded).sort()).toEqual(['exp', 'iat', 'role', 'userId']);
    expect(decoded).not.toHaveProperty('email');
    expect(decoded).not.toHaveProperty('username');
    expect(decoded).not.toHaveProperty('employeeCode');
    expect(decoded).not.toHaveProperty('passwordHash');
    expect(decoded).not.toHaveProperty('name');
    expect(decoded).not.toHaveProperty('teamId');
    expect(decoded).not.toHaveProperty('startDate');
  });

  it('GET /api/auth/me returns the same profile fields without sensitive data', async () => {
    await createProfileUser();

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ identifier: profileUser.username, password })
      .expect(200);

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${loginRes.body.token}`)
      .expect(200);

    expect(res.body.user).toMatchObject({
      _id: expect.any(String),
      name: profileUser.name,
      email: profileUser.email,
      username: profileUser.username,
      role: profileUser.role,
      employeeCode: profileUser.employeeCode,
      startDate: profileUser.startDate.toISOString()
    });
    expectNoSensitiveUserFields(res.body.user);
  });

  it('allows optional profile fields to be absent without failing login or /auth/me', async () => {
    const optionalUser = {
      employeeCode: 'AUTH-PROFILE-OPTIONAL',
      name: 'Optional Profile User',
      email: 'optional@auth-profile.test',
      username: undefined,
      teamId: undefined,
      startDate: undefined
    };
    await createProfileUser(optionalUser);

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ identifier: optionalUser.email, password })
      .expect(200);

    expect(loginRes.body.user).toMatchObject({
      name: optionalUser.name,
      email: optionalUser.email,
      role: profileUser.role,
      employeeCode: optionalUser.employeeCode
    });
    expect(loginRes.body.user).not.toHaveProperty('username');
    expect(loginRes.body.user).not.toHaveProperty('teamId');
    expect(loginRes.body.user).not.toHaveProperty('startDate');
    expectNoSensitiveUserFields(loginRes.body.user);

    const meRes = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${loginRes.body.token}`)
      .expect(200);

    expect(meRes.body.user).toMatchObject({
      name: optionalUser.name,
      email: optionalUser.email,
      role: profileUser.role,
      employeeCode: optionalUser.employeeCode
    });
    expect(meRes.body.user).not.toHaveProperty('username');
    expect(meRes.body.user).not.toHaveProperty('teamId');
    expect(meRes.body.user).not.toHaveProperty('startDate');
    expectNoSensitiveUserFields(meRes.body.user);
  });

  it('GET /api/auth/me without a bearer token returns 401', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .expect(401);

    expect(res.body).toEqual({ message: 'Authentication required' });
  });

  it('does not return a profile for inactive users', async () => {
    const user = await createProfileUser();
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ identifier: profileUser.email, password })
      .expect(200);

    await User.updateOne({ _id: user._id }, { $set: { isActive: false } });

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${loginRes.body.token}`)
      .expect(403);

    expect(res.body).toEqual({ message: 'Account is deactivated' });
  });

  it('does not return a profile for soft-deleted users', async () => {
    const user = await createProfileUser();
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ identifier: profileUser.email, password })
      .expect(200);

    await User.updateOne({ _id: user._id }, { $set: { deletedAt: new Date() } });

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${loginRes.body.token}`)
      .expect(401);

    expect(res.body).toEqual({ message: 'User not found' });
  });

  it('uses the generic invalid credentials response for wrong passwords and soft-deleted users', async () => {
    const softDeletedUser = {
      employeeCode: 'AUTH-PROFILE-DELETED',
      name: 'Soft Deleted Profile User',
      email: 'deleted@auth-profile.test',
      username: 'auth-profile-deleted',
      deletedAt: new Date()
    };
    await createProfileUser();
    await createProfileUser(softDeletedUser);

    const wrongPasswordRes = await request(app)
      .post('/api/auth/login')
      .send({ identifier: profileUser.email, password: 'WrongPassword123' })
      .expect(401);

    const deletedUserRes = await request(app)
      .post('/api/auth/login')
      .send({ identifier: softDeletedUser.email, password })
      .expect(401);

    expect(wrongPasswordRes.body).toEqual({ message: 'Invalid credentials' });
    expect(deletedUserRes.body).toEqual({ message: 'Invalid credentials' });
  });
});
