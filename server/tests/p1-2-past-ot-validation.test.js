import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';
import User from '../src/models/User.js';
import Request from '../src/models/Request.js';
import { createOtRequest } from '../src/services/requestService.js';
import { getDateKey } from '../src/utils/dateUtils.js';

const FIXED_TIME = new Date('2026-02-10T03:00:00.000Z');

describe('P1-2: Past OT Time Validation (STRICT)', () => {
  let testUser;

  beforeAll(async () => {
    // Connect to test database
    await mongoose.connect(
      process.env.MONGO_URI?.replace(/\/[^/]+$/, '/p1_2_test') || 
      'mongodb://localhost:27017/p1_2_test'
    );

    // Create test user with proper schema
    const timestamp = Date.now();
    testUser = await User.create({
      employeeCode: `P1-2-${timestamp}`,
      name: 'P1-2 Test User',
      email: `p1-2-user-${timestamp}@test.com`,
      username: `p1-2-user-${timestamp}`,
      passwordHash: '$2a$10$dummyhashfortest',
      role: 'EMPLOYEE',
      isActive: true
    });

    // Keep default test timeline deterministic.
    vi.setSystemTime(FIXED_TIME);
  });

  afterAll(async () => {
    vi.useRealTimers();

    // Cleanup
    if (testUser) {
      await Request.deleteMany({ userId: testUser._id });
      await User.deleteOne({ _id: testUser._id });
    }
    
    // Disconnect from database
    await mongoose.connection.close();
  });

  beforeEach(async () => {
    // Clean requests before each test
    await Request.deleteMany({ userId: testUser._id });
    vi.setSystemTime(FIXED_TIME);
  });

  describe('STRICT Policy: Block Retroactive Same-Day OT', () => {
    it('should REJECT OT request when estimatedEndTime is in the past', async () => {
      // Mock current time: 2026-02-10 23:00:00 GMT+7
      const mockNow = new Date('2026-02-10T16:00:00Z'); // 23:00 GMT+7
      vi.setSystemTime(mockNow);

      const today = getDateKey(mockNow);
      
      // Try to request OT for 18:00 (5 hours ago)
      const pastTime = new Date('2026-02-10T11:00:00Z'); // 18:00 GMT+7

      await expect(
        createOtRequest(testUser._id, {
          date: today,
          estimatedEndTime: pastTime,
          reason: 'Retroactive OT attempt'
        })
      ).rejects.toThrow(/Cannot create OT request for past time/);
    });

    it('should REJECT OT request when estimatedEndTime equals current time', async () => {
      // Mock current time: 2026-02-10 19:00:00 GMT+7
      const mockNow = new Date('2026-02-10T12:00:00Z'); // 19:00 GMT+7
      vi.setSystemTime(mockNow);

      const today = getDateKey(mockNow);
      
      // Try to request OT for exactly now
      const currentTime = new Date(mockNow);

      await expect(
        createOtRequest(testUser._id, {
          date: today,
          estimatedEndTime: currentTime,
          reason: 'Current time OT attempt'
        })
      ).rejects.toThrow(/Cannot create OT request for past time/);
    });

    it('should ALLOW OT request when estimatedEndTime is in the future', async () => {
      // Mock current time: 2026-02-10 16:00:00 GMT+7
      const mockNow = new Date('2026-02-10T09:00:00Z'); // 16:00 GMT+7
      vi.setSystemTime(mockNow);

      const today = getDateKey(mockNow);
      
      // Request OT for 19:00 (3 hours from now)
      const futureTime = new Date('2026-02-10T12:00:00Z'); // 19:00 GMT+7

      const request = await createOtRequest(testUser._id, {
        date: today,
        estimatedEndTime: futureTime,
        reason: 'Future OT request'
      });

      expect(request).toBeDefined();
      expect(request.status).toBe('PENDING');
      expect(request.type).toBe('OT_REQUEST');
    });

    it('should ALLOW OT request for future dates regardless of time', async () => {
      // Mock current time: 2026-02-10 23:00:00 GMT+7
      const mockNow = new Date('2026-02-10T16:00:00Z'); // 23:00 GMT+7
      vi.setSystemTime(mockNow);

      // Request OT for tomorrow at 19:00 (any time is OK for future dates, must be valid OT period)
      const tomorrow = '2026-02-11';
      const tomorrowTime = new Date('2026-02-11T12:00:00Z'); // 19:00 GMT+7 (valid OT period)

      const request = await createOtRequest(testUser._id, {
        date: tomorrow,
        estimatedEndTime: tomorrowTime,
        reason: 'Tomorrow OT request'
      });

      expect(request).toBeDefined();
      expect(request.status).toBe('PENDING');
      expect(request.date).toBe(tomorrow);
    });
  });

  describe('Error Message Quality', () => {
    it('should provide helpful error message with timestamps', async () => {
      // Mock current time: 2026-02-10 23:00:00 GMT+7
      const mockNow = new Date('2026-02-10T16:00:00Z'); // 23:00 GMT+7
      vi.setSystemTime(mockNow);

      const today = getDateKey(mockNow);
      const pastTime = new Date('2026-02-10T11:00:00Z'); // 18:00 GMT+7

      try {
        await createOtRequest(testUser._id, {
          date: today,
          estimatedEndTime: pastTime,
          reason: 'Test error message'
        });
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error.message).toContain('Cannot create OT request for past time');
        expect(error.message).toContain('Current time:');
        expect(error.message).toContain('Requested time:');
        expect(error.message).toContain('GMT+7');
        expect(error.message).toContain('contact your manager');
        expect(error.statusCode).toBe(400);
      }
    });
  });

  describe('Edge Cases', () => {
    it('should REJECT when estimatedEndTime is 1 second ago', async () => {
      // Mock current time: 2026-02-10 19:00:01 GMT+7
      const mockNow = new Date('2026-02-10T12:00:01Z');
      vi.setSystemTime(mockNow);

      const today = getDateKey(mockNow);
      
      // Try to request OT for 19:00:00 (1 second ago)
      const pastTime = new Date('2026-02-10T12:00:00Z');

      await expect(
        createOtRequest(testUser._id, {
          date: today,
          estimatedEndTime: pastTime,
          reason: '1 second ago test'
        })
      ).rejects.toThrow(/Cannot create OT request for past time/);
    });

    it('should ALLOW when estimatedEndTime is 1 second in future', async () => {
      // Mock current time: 2026-02-10 19:00:00 GMT+7
      const mockNow = new Date('2026-02-10T12:00:00Z');
      vi.setSystemTime(mockNow);

      const today = getDateKey(mockNow);
      
      // Request OT for 19:00:01 (1 second from now)
      const futureTime = new Date('2026-02-10T12:00:01Z');

      const request = await createOtRequest(testUser._id, {
        date: today,
        estimatedEndTime: futureTime,
        reason: '1 second future test'
      });

      expect(request).toBeDefined();
      expect(request.status).toBe('PENDING');
    });

    it('should REJECT late evening OT request for earlier time same day', async () => {
      // Mock current time: 2026-02-10 23:59:00 GMT+7
      const mockNow = new Date('2026-02-10T16:59:00Z');
      vi.setSystemTime(mockNow);

      const today = getDateKey(mockNow);
      
      // Try to request OT for 20:00 (3+ hours ago)
      const pastTime = new Date('2026-02-10T13:00:00Z'); // 20:00 GMT+7

      await expect(
        createOtRequest(testUser._id, {
          date: today,
          estimatedEndTime: pastTime,
          reason: 'Late evening retroactive attempt'
        })
      ).rejects.toThrow(/Cannot create OT request for past time/);
    });

    it('should ALLOW early morning OT request for evening same day', async () => {
      // Mock current time: 2026-02-10 08:00:00 GMT+7
      const mockNow = new Date('2026-02-10T01:00:00Z');
      vi.setSystemTime(mockNow);

      const today = getDateKey(mockNow);
      
      // Request OT for 20:00 (12 hours from now)
      const futureTime = new Date('2026-02-10T13:00:00Z'); // 20:00 GMT+7

      const request = await createOtRequest(testUser._id, {
        date: today,
        estimatedEndTime: futureTime,
        reason: 'Early morning planning'
      });

      expect(request).toBeDefined();
      expect(request.status).toBe('PENDING');
    });
  });

  describe('Business Scenarios', () => {
    it('Scenario A: Employee requests OT at 16:00 for 19:00 same day - SHOULD ALLOW', async () => {
      // Current: 2026-02-10 16:00:00 GMT+7
      const mockNow = new Date('2026-02-10T09:00:00Z');
      vi.setSystemTime(mockNow);

      const today = getDateKey(mockNow);
      const plannedEndTime = new Date('2026-02-10T12:00:00Z'); // 19:00 GMT+7

      const request = await createOtRequest(testUser._id, {
        date: today,
        estimatedEndTime: plannedEndTime,
        reason: 'Project deadline work'
      });

      expect(request.status).toBe('PENDING');
      expect(request.type).toBe('OT_REQUEST');
    });

    it('Scenario B: Employee tries to log OT at 23:00 for 18:00 same day - SHOULD REJECT', async () => {
      // Current: 2026-02-10 23:00:00 GMT+7
      const mockNow = new Date('2026-02-10T16:00:00Z');
      vi.setSystemTime(mockNow);

      const today = getDateKey(mockNow);
      const pastEndTime = new Date('2026-02-10T11:00:00Z'); // 18:00 GMT+7

      await expect(
        createOtRequest(testUser._id, {
          date: today,
          estimatedEndTime: pastEndTime,
          reason: 'Forgot to request earlier'
        })
      ).rejects.toThrow(/Cannot create OT request for past time/);
    });

    it('Scenario C: Employee at 23:00 requests OT for 23:30 same day - SHOULD ALLOW', async () => {
      // Current: 2026-02-10 23:00:00 GMT+7
      const mockNow = new Date('2026-02-10T16:00:00Z');
      vi.setSystemTime(mockNow);

      const today = getDateKey(mockNow);
      const futureEndTime = new Date('2026-02-10T16:30:00Z'); // 23:30 GMT+7

      const request = await createOtRequest(testUser._id, {
        date: today,
        estimatedEndTime: futureEndTime,
        reason: 'Last minute urgent task'
      });

      expect(request.status).toBe('PENDING');
    });

    it('Scenario D: Employee at 10:00 requests OT for tomorrow 19:00 - SHOULD ALLOW', async () => {
      // Current: 2026-02-10 10:00:00 GMT+7
      const mockNow = new Date('2026-02-10T03:00:00Z');
      vi.setSystemTime(mockNow);

      const tomorrow = '2026-02-11';
      const tomorrowEndTime = new Date('2026-02-11T12:00:00Z'); // 19:00 GMT+7

      const request = await createOtRequest(testUser._id, {
        date: tomorrow,
        estimatedEndTime: tomorrowEndTime,
        reason: 'Pre-planned OT for tomorrow'
      });

      expect(request.status).toBe('PENDING');
      expect(request.date).toBe(tomorrow);
    });
  });

  describe('Auto-Extend Behavior with Retroactive Check', () => {
    it('should allow auto-extend when new estimatedEndTime is still in future', async () => {
      // Current: 2026-02-10 16:00:00 GMT+7
      const mockNow = new Date('2026-02-10T09:00:00Z');
      vi.setSystemTime(mockNow);

      const today = getDateKey(mockNow);
      
      // Create initial request for 19:00
      const initialEndTime = new Date('2026-02-10T12:00:00Z');
      const request1 = await createOtRequest(testUser._id, {
        date: today,
        estimatedEndTime: initialEndTime,
        reason: 'Initial OT request'
      });

      expect(request1.status).toBe('PENDING');

      // Move time forward: now 17:00
      const mockNowLater = new Date('2026-02-10T10:00:00Z');
      vi.setSystemTime(mockNowLater);

      // Auto-extend to 20:00 (still in future)
      const extendedEndTime = new Date('2026-02-10T13:00:00Z');
      const request2 = await createOtRequest(testUser._id, {
        date: today,
        estimatedEndTime: extendedEndTime,
        reason: 'Extended OT request'
      });

      expect(request2._id.toString()).toBe(request1._id.toString());
      expect(request2.estimatedEndTime.getTime()).toBe(extendedEndTime.getTime());
    });

    it('should REJECT auto-extend when new estimatedEndTime is in past', async () => {
      // Current: 2026-02-10 16:00:00 GMT+7
      const mockNow = new Date('2026-02-10T09:00:00Z');
      vi.setSystemTime(mockNow);

      const today = getDateKey(mockNow);
      
      // Create initial request for 19:00
      const initialEndTime = new Date('2026-02-10T12:00:00Z');
      await createOtRequest(testUser._id, {
        date: today,
        estimatedEndTime: initialEndTime,
        reason: 'Initial OT request'
      });

      // Move time forward: now 20:00 (past the initial end time)
      const mockNowLater = new Date('2026-02-10T13:00:00Z');
      vi.setSystemTime(mockNowLater);

      // Try to extend to 19:00 (now in past)
      const pastEndTime = new Date('2026-02-10T12:00:00Z');
      await expect(
        createOtRequest(testUser._id, {
          date: today,
          estimatedEndTime: pastEndTime,
          reason: 'Retroactive extend attempt'
        })
      ).rejects.toThrow(/Cannot create OT request for past time/);
    });
  });

  describe('Integration with Other Validations', () => {
    it('should check past time BEFORE other validations', async () => {
      // Current: 2026-02-10 23:00:00 GMT+7
      const mockNow = new Date('2026-02-10T16:00:00Z');
      vi.setSystemTime(mockNow);

      const today = getDateKey(mockNow);
      
      // Try to request with past time AND invalid duration
      const pastTime = new Date('2026-02-10T10:30:00Z'); // 17:30 GMT+7 (only 30 min OT, but also past)

      await expect(
        createOtRequest(testUser._id, {
          date: today,
          estimatedEndTime: pastTime,
          reason: 'Multiple validation failures'
        })
      ).rejects.toThrow(/Cannot create OT request for past time/);
      // Should fail on past time check, not OT duration
    });

    it('should pass past time check, then validate OT period', async () => {
      // Current: 2026-02-10 16:00:00 GMT+7
      const mockNow = new Date('2026-02-10T09:00:00Z');
      vi.setSystemTime(mockNow);

      const today = getDateKey(mockNow);
      
      // Future time but before 17:30 (not in OT period)
      const futureButNotOtTime = new Date('2026-02-10T10:00:00Z'); // 17:00 GMT+7

      await expect(
        createOtRequest(testUser._id, {
          date: today,
          estimatedEndTime: futureButNotOtTime,
          reason: 'Not in OT period'
        })
      ).rejects.toThrow(/OT cannot end before 17:30/);
      // Should pass time check, fail OT period check
    });
  });

  describe('Timezone Consistency', () => {
    it('should handle GMT+7 timezone correctly in validation', async () => {
      // Current: 2026-02-10 18:00:00 GMT+7 = 2026-02-10T11:00:00Z
      const mockNow = new Date('2026-02-10T11:00:00Z');
      vi.setSystemTime(mockNow);

      const today = getDateKey(mockNow);
      
      // Request for 20:00 GMT+7 (future)
      const futureTime = new Date('2026-02-10T13:00:00Z');

      const request = await createOtRequest(testUser._id, {
        date: today,
        estimatedEndTime: futureTime,
        reason: 'Timezone test'
      });

      expect(request).toBeDefined();
      expect(request.status).toBe('PENDING');
    });

    it('should reject correctly across date boundaries (before midnight)', async () => {
      // Current: 2026-02-10 23:59:00 GMT+7 = 2026-02-10T16:59:00Z
      const mockNow = new Date('2026-02-10T16:59:00Z');
      vi.setSystemTime(mockNow);

      const today = getDateKey(mockNow); // Should be 2026-02-10
      
      // Try to request for 20:00 same day (past)
      const pastTime = new Date('2026-02-10T13:00:00Z'); // 20:00 GMT+7

      await expect(
        createOtRequest(testUser._id, {
          date: today,
          estimatedEndTime: pastTime,
          reason: 'Near midnight test'
        })
      ).rejects.toThrow(/Cannot create OT request for past time/);
    });
  });
});
