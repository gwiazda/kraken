import { describe, expect, it } from 'vitest';
import { fakeGoogleDrive, type FakeDrive } from '../testing/fakeGoogleDrive';
import { ConflictError, TableError, columnLetters, parseTable, rowCells, sheetRecordTable } from './records';

const SHEET = 'fake-sheet-for-records-00001';
const HEADERS = ['id', 'name', 'kg', 'created_at', 'updated_at', 'created_by', 'deleted_at'];
const t1 = new Date('2026-11-15T10:00:00.000Z');
const t2 = new Date('2026-11-15T11:00:00.000Z');
const t3 = new Date('2026-11-15T12:00:00.000Z');

function setup(rows: string[][] = [HEADERS]): { google: FakeDrive; table: ReturnType<typeof sheetRecordTable> } {
  const google = fakeGoogleDrive();
  google.addFile(SHEET, { name: 'Kraken', tabs: [{ title: 'Items', sheetId: 1, rows }] });
  let n = 0;
  const table = sheetRecordTable(google, SHEET, 'Items', ['name', 'kg'], () => `id-${++n}`);
  return { google, table };
}
const rowsOf = (google: FakeDrive) => google.files.get(SHEET)?.tabs[0]?.rows;

describe('columnLetters', () => {
  it.each([
    [1, 'A'],
    [21, 'U'],
    [26, 'Z'],
    [27, 'AA'],
    [52, 'AZ'],
    [53, 'BA'],
    [702, 'ZZ'],
    [703, 'AAA'],
  ])('%i -> %s', (n, letters) => {
    expect(columnLetters(n)).toBe(letters);
  });
});

describe('parseTable', () => {
  it('reads columns by their header name, in any order', () => {
    const values = [
      ['kg', 'deleted_at', 'name', 'id', 'created_at', 'updated_at', 'created_by'],
      ['60', '', 'Kenya', 'a1', 't', 't', 'me'],
    ];
    expect(parseTable('Items', values, ['name', 'kg']).records).toEqual([
      { row: 2, fields: { kg: '60', deleted_at: '', name: 'Kenya', id: 'a1', created_at: 't', updated_at: 't', created_by: 'me' } },
    ]);
  });

  it('keeps unknown columns, fills missing cells with empty text, skips empty rows', () => {
    const values = [[...HEADERS, 'added by hand'], ['a1', 'Kenya'], [], ['', ' '], ['a2', 'Burundi', '', '', '', '', '', 'x']];
    const { records, problems } = parseTable('Items', values, ['name']);
    expect(records.map((r) => [r.row, r.fields.name, r.fields.kg, r.fields['added by hand']])).toEqual([
      [2, 'Kenya', '', ''],
      [5, 'Burundi', '', 'x'],
    ]);
    expect(problems).toEqual([]);
  });

  it('reports rows without an ID or with a repeated ID, instead of dropping them silently', () => {
    const values = [HEADERS, ['a1', 'Kenya'], ['', 'Typed by hand'], ['a1', 'Copy of Kenya']];
    const { records, problems } = parseTable('Items', values, []);
    expect(records.map((r) => r.fields.name)).toEqual(['Kenya']);
    expect(problems).toEqual([
      'Row 3 of "Items" has no ID, so Kraken ignores it. Was it typed in by hand?',
      'Row 4 of "Items" has the same ID as row 2, so Kraken ignores it.',
    ]);
  });

  it('refuses a tab with missing or repeated columns', () => {
    expect(() => parseTable('Items', [['id', 'name']], ['kg'])).toThrow(TableError);
    expect(() => parseTable('Items', [['id', 'name']], ['kg'])).toThrow('missing the column(s): created_at, updated_at, created_by, deleted_at, kg');
    expect(() => parseTable('Items', [[...HEADERS, 'name']], [])).toThrow('has the column(s) name more than once');
    expect(() => parseTable('Items', [], [])).toThrow(TableError);
  });

  it('accepts numbers typed by hand in the sheet as text', () => {
    expect(parseTable('Items', [HEADERS, ['a1', 'Kenya', 60]], []).records[0]?.fields.kg).toBe('60');
  });
});

describe('rowCells', () => {
  it('writes given fields by header and keeps the other cells', () => {
    expect(rowCells(['id', 'name', 'extra', ''], { name: 'New', id: 'a1' }, ['a1', 'Old', 'keep me', 'and me'])).toEqual([
      'a1',
      'New',
      'keep me',
      'and me',
    ]);
  });
});

describe('sheetRecordTable', () => {
  it('adds a record with a new ID, the times and who added it, in header order', async () => {
    const { google, table } = setup();
    const stored = await table.add({ name: 'Kenya', kg: '60' }, 'owner@example.com', t1);
    expect(stored).toEqual({
      name: 'Kenya',
      kg: '60',
      id: 'id-1',
      created_at: '2026-11-15T10:00:00.000Z',
      updated_at: '2026-11-15T10:00:00.000Z',
      created_by: 'owner@example.com',
      deleted_at: '',
    });
    expect(rowsOf(google)).toEqual([HEADERS, ['id-1', 'Kenya', '60', '2026-11-15T10:00:00.000Z', '2026-11-15T10:00:00.000Z', 'owner@example.com', '']]);
    const append = google.requests.find((r) => r.url.includes(':append'));
    expect(append?.url).toContain('valueInputOption=RAW');
    expect(append?.url).toContain('insertDataOption=INSERT_ROWS');
  });

  it('reads back what it wrote', async () => {
    const { table } = setup();
    const a = await table.add({ name: 'Kenya', kg: '60' }, 'me', t1);
    const b = await table.add({ name: 'Burundi', kg: '60' }, 'me', t1);
    expect((await table.load()).records.map((r) => r.fields)).toEqual([a, b]);
  });

  it('never lets a feature write the safety columns itself', async () => {
    const { table } = setup();
    await expect(table.add({ name: 'x', id: 'mine' }, 'me', t1)).rejects.toThrow('may not write id');
    const a = await table.add({ name: 'x' }, 'me', t1);
    await expect(table.update(a.id ?? '', { created_by: 'someone' }, a.updated_at ?? '', t2)).rejects.toThrow('may not write created_by');
  });

  it('changes only the given fields, in the right row, and keeps columns Kraken does not know', async () => {
    const { google, table } = setup([[...HEADERS, 'owner note']]);
    await table.add({ name: 'Kenya', kg: '60' }, 'me', t1);
    const b = await table.add({ name: 'Burundi', kg: '60' }, 'me', t1);
    const rows = rowsOf(google);
    if (rows?.[2]) rows[2][7] = 'typed in the sheet';

    const changed = await table.update(b.id ?? '', { kg: '59.5' }, b.updated_at ?? '', t2);

    expect(changed.kg).toBe('59.5');
    expect(changed.updated_at).toBe('2026-11-15T11:00:00.000Z');
    expect(changed.created_at).toBe('2026-11-15T10:00:00.000Z');
    expect(rowsOf(google)?.[1]?.[1]).toBe('Kenya');
    expect(rowsOf(google)?.[2]).toEqual(['id-2', 'Burundi', '59.5', '2026-11-15T10:00:00.000Z', '2026-11-15T11:00:00.000Z', 'me', '', 'typed in the sheet']);
  });

  it('finds the record again even if rows moved since loading', async () => {
    const { google, table } = setup();
    await table.add({ name: 'Kenya' }, 'me', t1);
    const b = await table.add({ name: 'Burundi' }, 'me', t1);
    rowsOf(google)?.splice(1, 0, ['', '', '']); // someone inserted an empty row above
    await table.update(b.id ?? '', { kg: '1' }, b.updated_at ?? '', t2);
    expect(rowsOf(google)?.[3]?.[2]).toBe('1');
  });

  it('refuses to overwrite a change someone else made since loading (and writes nothing)', async () => {
    const { google, table } = setup();
    const a = await table.add({ name: 'Kenya', kg: '60' }, 'me', t1);
    await table.update(a.id ?? '', { kg: '50' }, a.updated_at ?? '', t2); // the partner's change
    const before = structuredClone(rowsOf(google));

    await expect(table.update(a.id ?? '', { kg: '40' }, a.updated_at ?? '', t3)).rejects.toBeInstanceOf(ConflictError);
    expect(rowsOf(google)).toEqual(before);
  });

  it('refuses to change a record that is gone', async () => {
    const { table } = setup();
    await expect(table.update('nope', { kg: '1' }, '', t1)).rejects.toThrow('no longer in "Items"');
  });

  it('soft-deletes and restores, keeping the row', async () => {
    const { google, table } = setup();
    const a = await table.add({ name: 'Kenya' }, 'me', t1);
    const deleted = await table.remove(a.id ?? '', a.updated_at ?? '', t2);
    expect(deleted.deleted_at).toBe('2026-11-15T11:00:00.000Z');
    expect(rowsOf(google)).toHaveLength(2);
    expect((await table.load()).records[0]?.fields.deleted_at).toBe('2026-11-15T11:00:00.000Z');

    const restored = await table.restore(a.id ?? '', deleted.updated_at ?? '', t3);
    expect(restored.deleted_at).toBe('');
    expect(restored.name).toBe('Kenya');
  });

  it('refuses to read or write a tab whose columns are missing', async () => {
    const { table } = setup([['id', 'name']]);
    await expect(table.load()).rejects.toBeInstanceOf(TableError);
    await expect(table.add({ name: 'x' }, 'me', t1)).rejects.toBeInstanceOf(TableError);
  });
});
