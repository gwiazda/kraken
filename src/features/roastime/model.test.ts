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
    ['roast-time/roasts/R1', 'roasts'],
    ['roast-time/recipes/X', null],
    ['roast-time/containers/sub/C1', null],
    ['roast-time/db.sqlite3', null],
    ['roast-time/containers/.DS_Store', null],
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
      { path: 'roast-time/recipes/X', text: 'not even json' },
    ]);
    expect(data).toEqual({
      containers: [{ id: 'C1', beanId: 'B1', startGrams: 60000, deleted: false, createdAt: new Date('2026-11-03T00:00:00Z') }],
      beans: [{ id: 'B1', name: 'Example Kenya', country: 'Kenya', region: 'Nyeri', process: 'Washed', vendorCode: 'V1' }],
      roasts: [],
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
      'Nie udało się odczytać pliku RoasTime containers/X, więc Kraken go pominął.',
      'Dostawie RoasTime containers/Y brakuje identyfikatora, kawy albo ilości początkowej, więc Kraken ją pominął.',
      'Nie udało się odczytać pliku RoasTime containers/Z, więc Kraken go pominął.',
      'Kawa RoasTime beans/W nie ma identyfikatora, więc Kraken ją pominął.',
    ]);
  });
});

describe('parseRoastimeFiles: roasts', () => {
  // Made-up, shaped like docs/samples/roastime-roast.example.json (only the summary fields matter).
  const roastFile = (o: Record<string, unknown> = {}) =>
    JSON.stringify({ uid: 'R1', dateTime: Date.UTC(2026, 10, 3, 8, 15), roastName: 'Kenia 03.11.2026-1', beanId: 'B1', weightGreen: 1200, weightRoasted: 1026.5, beanTemperature: [1, 2, 3], ...o });

  it('keeps only the summary of a roast', () => {
    const data = parseRoastimeFiles([{ path: 'roast-time/roasts/R1', text: roastFile({ comments: ' a bit fast ' }) }]);
    expect(data.roasts).toEqual([
      { id: 'R1', roastedAt: new Date(Date.UTC(2026, 10, 3, 8, 15)), name: 'Kenia 03.11.2026-1', beanId: 'B1', greenGrams: 1200, roastedDecigrams: 10265, comment: 'a bit fast' },
    ]);
  });

  it('reads weights written as text, and treats 0 or missing as not entered', () => {
    const [a] = parseRoastimeFiles([{ path: 'roast-time/roasts/R1', text: roastFile({ weightGreen: '150', weightRoasted: '132.5' }) }]).roasts;
    expect(a).toMatchObject({ greenGrams: 150, roastedDecigrams: 1325 });
    const [b] = parseRoastimeFiles([{ path: 'roast-time/roasts/R1', text: roastFile({ weightGreen: 0, weightRoasted: 0, beanId: undefined }) }]).roasts;
    expect(b).toMatchObject({ greenGrams: 0, roastedDecigrams: null, beanId: '' });
    const [c] = parseRoastimeFiles([{ path: 'roast-time/roasts/R1', text: roastFile({ weightGreen: 'abc', weightRoasted: -5 }) }]).roasts;
    expect(c).toMatchObject({ greenGrams: null, roastedDecigrams: null });
  });

  it('reports a roast without an ID', () => {
    expect(parseRoastimeFiles([{ path: 'roast-time/roasts/X', text: roastFile({ uid: '' }) }]).problems).toEqual(['Wypał RoasTime roasts/X nie ma identyfikatora, więc Kraken go pominął.']);
  });
});
