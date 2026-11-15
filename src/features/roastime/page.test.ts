import { describe, expect, it } from 'vitest';
import { summaryOf } from './page';

describe('summaryOf', () => {
  it('counts added and updated lots', () => {
    const op = (label: string) => ({ kind: 'add' as const, fields: {}, label });
    expect(summaryOf([op('Add A'), op('Add B'), op('Update D')])).toBe('2 added, 1 updated');
    expect(summaryOf([op('Update D')])).toBe('1 updated');
  });
});
