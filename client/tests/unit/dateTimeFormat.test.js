import { describe, expect, it } from 'vitest';
import { formatDurationByMode } from '../../src/utils/dateTimeFormat';

describe('dateTimeFormat.formatDurationByMode', () => {
    it('formats minutes mode as Vietnamese minutes text', () => {
        expect(formatDurationByMode(849, 'minutes')).toBe('849 phút');
    });

    it('formats hours mode as hour/minute text', () => {
        expect(formatDurationByMode(849, 'hours')).toBe('14h 9m');
    });

    it('handles zero in both modes', () => {
        expect(formatDurationByMode(0, 'minutes')).toBe('0 phút');
        expect(formatDurationByMode(0, 'hours')).toBe('0h 0m');
    });

    it('returns dash for invalid values', () => {
        expect(formatDurationByMode(null, 'minutes')).toBe('-');
        expect(formatDurationByMode(undefined, 'hours')).toBe('-');
        expect(formatDurationByMode(-1, 'hours')).toBe('-');
        expect(formatDurationByMode(Number.NaN, 'minutes')).toBe('-');
    });
});
