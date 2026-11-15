import { describe, expect, it } from 'vitest';
import { wantsNewSheet } from './newSheetMode';

describe('wantsNewSheet', () => {
  it.each([
    ['', false],
    ['?', false],
    ['?other=1', false],
    ['?new-sheet', true],
    ['?new-sheet=', true],
    ['?x=1&new-sheet', true],
    ['?New-Sheet', true],
    ['?newsheet', false],
  ])('%s -> %s', (search, expected) => {
    expect(wantsNewSheet(search)).toBe(expected);
  });
});
