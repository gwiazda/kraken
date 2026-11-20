import { describe, expect, it } from 'vitest';
import { formatDate, formatDateTime, localDate } from './dates';

describe('localDate', () => {
  it('uses the local calendar date with leading zeros', () => {
    expect(localDate(new Date(2026, 10, 15, 23, 59))).toBe('2026-11-15');
    expect(localDate(new Date(2027, 0, 5, 0, 1))).toBe('2027-01-05');
  });
});

describe('formatDate', () => {
  it('writes a date the Polish way, and leaves anything else as it is', () => {
    expect(formatDate('2026-11-20')).toBe('20.11.2026');
    expect(formatDate('2027-01-05')).toBe('05.01.2027');
    expect(formatDate('')).toBe('');
    expect(formatDate('soon')).toBe('soon');
  });

  it('writes a date and time in local time', () => {
    expect(formatDateTime(new Date(2026, 10, 20, 9, 5))).toBe('20.11.2026 09:05');
  });
});
