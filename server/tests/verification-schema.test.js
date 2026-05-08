import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import Request from '../src/models/Request.js';
import User from '../src/models/User.js';

describe('🧪 VERIFICATION: Request Schema Enum', () => {
  let testUser;

  beforeAll(async () => {
    // Connect to test database
    // Create test user
    const timestamp = Date.now();
    testUser = await User.create({
      employeeCode: `VERIFY-${timestamp}`,
      name: 'Verification Test User',
      email: `verify-${timestamp}@test.com`,
      passwordHash: '$2a$10$dummyhash',
      role: 'EMPLOYEE',
      isActive: true
    });
  });

  afterAll(async () => {
    // Cleanup
    if (testUser) {
      await Request.deleteMany({ userId: testUser._id });
      await User.deleteOne({ _id: testUser._id });
    }
  });

  it('CRITICAL: OT_REQUEST should be in schema enum', async () => {
    console.log('\nChecking Request schema enum...');
    
    // Get schema definition
    const schema = Request.schema;
    const typeField = schema.path('type');
    const enumValues = typeField.enumValues;
    
    console.log('  Schema enum values:', enumValues);
    console.log('  Contains OT_REQUEST?', enumValues.includes('OT_REQUEST'));
    
    expect(enumValues).toContain('ADJUST_TIME');
    expect(enumValues).toContain('LEAVE');
    expect(enumValues).toContain('OT_REQUEST'); // ← Critical check
  });

  it('RUNTIME: Should create OT_REQUEST successfully', async () => {
    console.log('\nTesting OT_REQUEST creation...');
    
    const otRequest = await Request.create({
      userId: testUser._id,
      type: 'OT_REQUEST',
      date: '2026-02-10',
      checkInDate: '2026-02-10',
      estimatedEndTime: new Date('2026-02-10T12:00:00Z'), // 19:00 GMT+7
      reason: 'Verification test OT request',
      status: 'PENDING'
    });

    console.log('  Created request ID:', otRequest._id);
    console.log('  Type:', otRequest.type);
    console.log('  Status:', otRequest.status);
    
    expect(otRequest).toBeDefined();
    expect(otRequest.type).toBe('OT_REQUEST');
    expect(otRequest.status).toBe('PENDING');
    
    // Cleanup
    await Request.deleteOne({ _id: otRequest._id });
  });

  it('RUNTIME: Should create ADJUST_TIME successfully', async () => {
    console.log('\nTesting ADJUST_TIME creation...');
    
    const adjustRequest = await Request.create({
      userId: testUser._id,
      type: 'ADJUST_TIME',
      date: '2026-02-10',
      checkInDate: '2026-02-10',
      requestedCheckInAt: new Date('2026-02-10T01:00:00Z'), // 08:00 GMT+7
      reason: 'Verification test adjust time',
      status: 'PENDING'
    });

    console.log('  Created request ID:', adjustRequest._id);
    console.log('  Type:', adjustRequest.type);
    
    expect(adjustRequest.type).toBe('ADJUST_TIME');
    
    // Cleanup
    await Request.deleteOne({ _id: adjustRequest._id });
  });

  it('RUNTIME: Should create LEAVE successfully', async () => {
    console.log('\nTesting LEAVE creation...');
    
    const leaveRequest = await Request.create({
      userId: testUser._id,
      type: 'LEAVE',
      leaveStartDate: '2026-02-10',
      leaveEndDate: '2026-02-10',
      leaveType: 'SICK',
      workdaysCount: 1,
      reason: 'Verification test leave',
      status: 'PENDING'
    });

    console.log('  Created request ID:', leaveRequest._id);
    console.log('  Type:', leaveRequest.type);
    
    expect(leaveRequest.type).toBe('LEAVE');
    
    // Cleanup
    await Request.deleteOne({ _id: leaveRequest._id });
  });

  it('VALIDATION: Should reject invalid type', async () => {
    console.log('\nTesting invalid type rejection...');
    
    try {
      await Request.create({
        userId: testUser._id,
        type: 'INVALID_TYPE',
        date: '2026-02-10',
        reason: 'Should fail',
        status: 'PENDING'
      });
      
      // Should not reach here
      expect.fail('Should have thrown validation error');
    } catch (error) {
      console.log('  Validation error (expected):', error.message);
      expect(error.name).toBe('ValidationError');
      expect(error.message).toContain('`INVALID_TYPE` is not a valid enum value');
    }
  });

  it('ALL ENUM VALUES: Should have exactly 3 types', () => {
    const schema = Request.schema;
    const typeField = schema.path('type');
    const enumValues = typeField.enumValues;
    
    console.log('\nEnum completeness check:');
    console.log('  Total enum values:', enumValues.length);
    console.log('  Values:', enumValues);
    
    expect(enumValues).toHaveLength(3);
    expect(enumValues).toEqual(
      expect.arrayContaining(['ADJUST_TIME', 'LEAVE', 'OT_REQUEST'])
    );
  });
});
