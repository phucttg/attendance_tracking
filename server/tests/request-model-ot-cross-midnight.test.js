import { describe, it, expect } from 'vitest';
import mongoose from 'mongoose';
import Request from '../src/models/Request.js';

const buildOtDoc = (overrides = {}) => ({
  userId: new mongoose.Types.ObjectId(),
  type: 'OT_REQUEST',
  date: '2026-03-02',
  estimatedEndTime: new Date('2026-03-02T19:00:00+07:00'),
  reason: 'Model validation test',
  status: 'PENDING',
  ...overrides
});

describe('Request model - OT cross-midnight validation', () => {
  it('accepts next-day estimatedEndTime before 08:00', async () => {
    const doc = new Request(buildOtDoc({
      estimatedEndTime: new Date('2026-03-03T00:30:00+07:00')
    }));

    await expect(doc.validate()).resolves.toBeUndefined();
  });

  it('rejects next-day estimatedEndTime at 08:00 or later', async () => {
    const doc = new Request(buildOtDoc({
      estimatedEndTime: new Date('2026-03-03T08:00:00+07:00')
    }));

    await expect(doc.validate()).rejects.toThrow(/07:59/);
  });

  it('rejects estimatedEndTime beyond immediate next day', async () => {
    const doc = new Request(buildOtDoc({
      estimatedEndTime: new Date('2026-03-04T00:30:00+07:00')
    }));

    await expect(doc.validate()).rejects.toThrow(/2026-03-03/);
  });

  it('keeps same-day minimum end time validation unchanged', async () => {
    const doc = new Request(buildOtDoc({
      estimatedEndTime: new Date('2026-03-02T17:50:00+07:00')
    }));

    await expect(doc.validate()).rejects.toThrow(/minimum end time/);
  });
});
