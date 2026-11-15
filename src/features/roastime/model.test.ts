import { describe, expect, it } from 'vitest';
import { kindOf, looksLikeRoastimeFolder, parseRoastimeFiles } from './model';

// Made-up data, shaped like docs/samples/roastime-*.example.json.
const container = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    id: 'C1',
    beanId: 'B1',
    startOnHand: 60000,
    deleted: false,
    createdAt: { _seconds: 1793664000, _nanoseconds: 0 }, // 2026-11-03T00:00:00Z
    defaultCost: { amount: 999 },
    ...overrides,
  });
const bean = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({ uid: 'B1', name: ' Example Kenya ', country: 'Kenya', region: 'Nyeri', process: 'Washed', vendorIds: ['V1'], elevation: 0, ...overrides });

describe('kindOf', () => {
  it.each([
    ['roast-time/containers/C1', 'containers'],
    ['roast-time/beans/B1', 'beans'],
    ['roast-time/roasts/R1', null],
    ['roast-time/containers/sub/C1', null],
    ['roast-time/db.sqlite3', null],
    ['containers/C1', null],
  ])('%s -> %s', (path, kind) => {
    expect(kindOf(path)).toBe(kind);
  });
});

describe('looksLikeRoastimeFolder', () => {
  it('needs both deliveries and coffees', () => {
    expect(looksLikeRoastimeFolder(['roast-time/containers/C1', 'roast-time/beans/B1'])).toBe(true);
    expect(looksLikeRoastimeFolder(['Downloads/photo.jpg'])).toBe(false);
    expect(looksLikeRoastimeFolder(['roast-time/beans/B1'])).toBe(false);
  });
});

describe('parseRoastimeFiles', () => {
  it('reads deliveries and coffees, ignoring the price RoasTime holds', () => {
    const data = parseRoastimeFiles([
      { path: 'roast-time/containers/C1', text: container() },
      { path: 'roast-time/beans/B1', text: bean() },
      { path: 'roast-time/roasts/R1', text: 'not even json' },
    ]);
    expect(data).toEqual({
      containers: [{ id: 'C1', beanId: 'B1', startGrams: 60000, deleted: false, createdAt: new Date('2026-11-03T00:00:00Z') }],
      beans: [{ id: 'B1', name: 'Example Kenya', country: 'Kenya', region: 'Nyeri', process: 'Washed', vendorCode: 'V1' }],
      problems: [],
    });
  });

  it('copes with missing optional fields', () => {
    const data = parseRoastimeFiles([
      { path: 'roast-time/containers/C1', text: container({ createdAt: undefined, deleted: undefined }) },
      { path: 'roast-time/beans/B1', text: JSON.stringify({ uid: 'B1', name: 'Old bean' }) },
    ]);
    expect(data.containers[0]).toMatchObject({ deleted: false, createdAt: null });
    expect(data.beans[0]).toEqual({ id: 'B1', name: 'Old bean', country: '', region: '', process: '', vendorCode: '' });
  });

  it('reads a creation time given in milliseconds', () => {
    const data = parseRoastimeFiles([{ path: 'roast-time/containers/C1', text: container({ createdAt: 1793664000000 }) }]);
    expect(data.containers[0]?.createdAt).toEqual(new Date('2026-11-03T00:00:00Z'));
  });

  it('skips broken files and says which', () => {
    const data = parseRoastimeFiles([
      { path: 'roast-time/containers/X', text: '{broken' },
      { path: 'roast-time/containers/Y', text: container({ startOnHand: 'sixty' }) },
      { path: 'roast-time/containers/Z', text: '[1,2]' },
      { path: 'roast-time/beans/W', text: JSON.stringify({ name: 'no id' }) },
    ]);
    expect(data.containers).toEqual([]);
    expect(data.beans).toEqual([]);
    expect(data.problems).toEqual([
      'RoasTime file containers/X could not be read, so Kraken skipped it.',
      'RoasTime delivery containers/Y is missing its ID, coffee or starting amount, so Kraken skipped it.',
      'RoasTime file containers/Z could not be read, so Kraken skipped it.',
      'RoasTime coffee beans/W has no ID, so Kraken skipped it.',
    ]);
  });
});
