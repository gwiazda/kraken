import { describe, expect, it } from 'vitest';
import { count, plural } from './polish';

describe('plural', () => {
  it.each([
    [0, 'wypałów'],
    [1, 'wypał'],
    [2, 'wypały'],
    [4, 'wypały'],
    [5, 'wypałów'],
    [11, 'wypałów'],
    [12, 'wypałów'],
    [14, 'wypałów'],
    [21, 'wypałów'],
    [22, 'wypały'],
    [24, 'wypały'],
    [25, 'wypałów'],
    [101, 'wypałów'],
    [102, 'wypały'],
    [112, 'wypałów'],
  ])('%i → %s', (n, word) => {
    expect(plural(n, 'wypał', 'wypały', 'wypałów')).toBe(word);
  });

  it('writes the number with its word', () => {
    expect(count(5, 'torebka', 'torebki', 'torebek')).toBe('5 torebek');
    expect(count(1, 'torebka', 'torebki', 'torebek')).toBe('1 torebka');
  });
});
