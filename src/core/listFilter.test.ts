import { describe, expect, it } from 'vitest';
import { anyFilter, choicesOf, emptyListState, isActive, listPage, monthsOf, searchable, type ListColumn, type ListState } from './listFilter';

// Made-up roasts.
interface Row {
  date: string;
  name: string;
  coffee: string;
  green: number | null;
  lots: string[];
}
const rows: Row[] = [
  { date: '2026-11-20', name: 'Espresso Kenia', coffee: 'KENIA', green: 1200, lots: ['KENYA-26-09'] },
  { date: '2026-11-03', name: 'Filtr Żółty', coffee: 'Etiopia', green: 800, lots: ['ETH-26-01', 'ETH-26-02'] },
  { date: '2026-10-28', name: 'Próbka', coffee: 'KENIA', green: null, lots: ['Not counted: no green weight'] },
  { date: '2026-10-02', name: 'Espresso Peru', coffee: 'Peru', green: 2500, lots: ['PERU-26-01'] },
];
const kg = (t: string) => {
  const n = Number(t.replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 1000) : null;
};
const columns: ListColumn<Row>[] = [
  { kind: 'month', key: 'date', label: 'Date', value: (r) => r.date },
  { kind: 'text', key: 'name', label: 'Name', value: (r) => r.name },
  { kind: 'choice', key: 'coffee', label: 'Coffee', values: (r) => [r.coffee] },
  { kind: 'range', key: 'green', label: 'Green', value: (r) => r.green, parse: kg },
  { kind: 'choice', key: 'lots', label: 'Lot', values: (r) => r.lots },
];
const text = (r: Row) => `${r.date} ${r.name} ${r.coffee} ${r.lots.join(' ')}`;
const names = (state: Partial<ListState>) => listPage(rows, columns, { ...emptyListState(), ...state }, text).rows.map((r) => r.name);

describe('listPage', () => {
  it('shows everything without a search or filter, in the same order', () => {
    expect(names({})).toEqual(['Espresso Kenia', 'Filtr Żółty', 'Próbka', 'Espresso Peru']);
  });

  it('searches every column, ignoring capitals and accents', () => {
    expect(names({ search: 'kenia' })).toEqual(['Espresso Kenia', 'Próbka']);
    expect(names({ search: 'zolty' })).toEqual(['Filtr Żółty']);
    expect(names({ search: 'eth-26-02' })).toEqual(['Filtr Żółty']);
    expect(searchable('  Kenia  Ñ ')).toBe('kenia n');
  });

  it('filters each kind of column, and all filters together', () => {
    expect(names({ filters: { date: '2026-11' } })).toEqual(['Espresso Kenia', 'Filtr Żółty']);
    expect(names({ filters: { name: 'espresso' } })).toEqual(['Espresso Kenia', 'Espresso Peru']);
    expect(names({ filters: { coffee: 'KENIA' } })).toEqual(['Espresso Kenia', 'Próbka']);
    expect(names({ filters: { lots: 'ETH-26-02' } })).toEqual(['Filtr Żółty']); // one of several lots
    expect(names({ filters: { green: { from: '1', to: '' } } })).toEqual(['Espresso Kenia', 'Espresso Peru']); // at least 1 kg
    expect(names({ filters: { green: { from: '', to: '1,2' } } })).toEqual(['Espresso Kenia', 'Filtr Żółty']); // up to 1,2 kg
    expect(names({ filters: { green: { from: 'abc', to: '' } } })).toEqual(['Espresso Kenia', 'Filtr Żółty', 'Próbka', 'Espresso Peru']); // nothing readable yet
    expect(names({ filters: { coffee: 'KENIA', date: '2026-10' } })).toEqual(['Próbka']);
  });

  it('pages: 2 per page, the second page, and the page corrected when fewer are left', () => {
    const page = listPage(rows, columns, { ...emptyListState(), pageSize: 2, page: 2 }, text);
    expect(page).toMatchObject({ matching: 4, total: 4, page: 2, pages: 2, first: 3, last: 4 });
    expect(page.rows.map((r) => r.name)).toEqual(['Próbka', 'Espresso Peru']);
    expect(listPage(rows, columns, { ...emptyListState(), pageSize: 2, page: 5, search: 'espresso' }, text)).toMatchObject({ page: 1, pages: 1, first: 1, last: 2 });
    expect(listPage(rows, columns, { ...emptyListState(), pageSize: 0 }, text)).toMatchObject({ pages: 1, first: 1, last: 4 }); // all on one page
    expect(listPage(rows, columns, { ...emptyListState(), search: 'nothing like it' }, text)).toMatchObject({ matching: 0, pages: 1, first: 0, last: 0 });
  });

  it('knows when anything narrows the list', () => {
    expect(anyFilter(emptyListState())).toBe(false);
    expect(anyFilter({ ...emptyListState(), filters: { green: { from: '', to: ' ' }, name: '' } })).toBe(false);
    expect(anyFilter({ ...emptyListState(), filters: { coffee: 'KENIA' } })).toBe(true);
    expect(isActive({ from: '1', to: '' })).toBe(true);
  });
});

describe('the lists to choose from', () => {
  it('gives each value once with its count, in Polish alphabetical order', () => {
    expect(choicesOf(rows, (r) => r.lots)).toEqual([
      { value: 'ETH-26-01', count: 1 },
      { value: 'ETH-26-02', count: 1 },
      { value: 'KENYA-26-09', count: 1 },
      { value: 'Not counted: no green weight', count: 1 },
      { value: 'PERU-26-01', count: 1 },
    ]);
    expect(choicesOf(rows, (r) => [r.coffee])).toEqual([
      { value: 'Etiopia', count: 1 },
      { value: 'KENIA', count: 2 },
      { value: 'Peru', count: 1 },
    ]);
  });

  it('gives the months, newest first, with their names', () => {
    expect(monthsOf(rows, (r) => r.date)).toEqual([
      { value: '2026-11', label: 'November 2026', count: 2 },
      { value: '2026-10', label: 'October 2026', count: 2 },
    ]);
  });
});
