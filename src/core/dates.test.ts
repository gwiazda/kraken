import { describe, expect, it } from 'vitest';
import { localDate } from './dates';

describe('localDate', () => {
  it('uses the local calendar date with leading zeros', () => {
    expect(localDate(new Date(2026, 10, 15, 23, 59))).toBe('2026-11-15');
    expect(localDate(new Date(2027, 0, 5, 0, 1))).toBe('2027-01-05');
  });
});
