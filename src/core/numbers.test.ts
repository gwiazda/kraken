import { describe, expect, it } from 'vitest';
import { divideRounded, formatKg, formatPln, kgText, moneyText, parseDecimal, parseKg, parseMoney, toDecimalText } from './numbers';

describe('parseMoney (grosze)', () => {
  it.each([
    ['1234.56', 123456],
    ['1234,56', 123456],
    ['1 234,56', 123456],
    ['1 234,5', 123450],
    ['60', 6000],
    ['0', 0],
    ['0.1', 10],
    [' 7. ', 700],
  ])('%s -> %i', (text, grosze) => {
    expect(parseMoney(text)).toBe(grosze);
  });

  it('gives null for empty text (not entered yet)', () => {
    expect(parseMoney('')).toBeNull();
    expect(parseMoney('   ')).toBeNull();
  });

  it.each(['abc', '-5', '1.234', '1,2,3', '12zł', '1e3', '.5', '99999999999999999999'])('rejects %s', (text) => {
    expect(parseMoney(text)).toBeUndefined();
  });

  it('adds exactly (no floating-point errors)', () => {
    expect((parseMoney('0.1') ?? 0) + (parseMoney('0.2') ?? 0)).toBe(parseMoney('0.3'));
  });
});

describe('parseKg (grams)', () => {
  it.each([
    ['60', 60000],
    ['21,5', 21500],
    ['0.125', 125],
  ])('%s -> %i', (text, grams) => {
    expect(parseKg(text)).toBe(grams);
  });

  it('rejects more than 3 decimals', () => {
    expect(parseKg('1.0001')).toBeUndefined();
  });
});

describe('stored text', () => {
  it.each([
    [123456, '1234.56'],
    [123450, '1234.5'],
    [6000, '60'],
    [5, '0.05'],
    [0, '0'],
  ])('money %i -> %s', (grosze, text) => {
    expect(moneyText(grosze)).toBe(text);
    expect(parseMoney(text)).toBe(grosze);
  });

  it('kg', () => {
    expect(kgText(60000)).toBe('60');
    expect(kgText(21500)).toBe('21.5');
    expect(kgText(125)).toBe('0.125');
  });

  it('refuses amounts that are not whole and non-negative', () => {
    expect(() => toDecimalText(1.5, 2)).toThrow();
    expect(() => toDecimalText(-1, 2)).toThrow();
  });

  it('parseDecimal and toDecimalText round-trip', () => {
    for (const units of [0, 1, 9, 10, 99, 100, 101, 123456789]) {
      expect(parseDecimal(toDecimalText(units, 3), 3)).toBe(units);
    }
  });
});

describe('divideRounded', () => {
  it('rounds half up', () => {
    expect(divideRounded(10, 4)).toBe(3); // 2.5 -> 3
    expect(divideRounded(9, 4)).toBe(2); // 2.25 -> 2
    expect(divideRounded(11, 4)).toBe(3); // 2.75 -> 3
    expect(divideRounded(0, 7)).toBe(0);
  });

  it('refuses dividing by zero', () => {
    expect(() => divideRounded(1, 0)).toThrow();
  });
});

describe('screen formats', () => {
  it('shows PLN the Polish way', () => {
    expect(formatPln(123456)).toBe('1 234,56 zł');
    expect(formatPln(5)).toBe('0,05 zł');
    expect(formatPln(100000000)).toBe('1 000 000,00 zł');
  });

  it('shows kg with a comma', () => {
    expect(formatKg(21500)).toBe('21,5 kg');
    expect(formatKg(60000)).toBe('60 kg');
  });
});
