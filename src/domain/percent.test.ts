import { describe, expect, it } from 'vitest';
import { marginText } from './percent';

describe('marginText', () => {
  it('shows a gross margin with the Polish percent sign, a loss with a minus, and nothing when unknown', () => {
    expect(marginText(56)).toBe('56 %');
    expect(marginText(-5)).toBe('−5 %');
    expect(marginText(0)).toBe('0 %');
    expect(marginText(null)).toBe('');
  });
});
