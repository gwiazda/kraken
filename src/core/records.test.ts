import { describe, expect, it } from 'vitest';
import { fakeGoogleDrive, type FakeDrive } from '../testing/fakeGoogleDrive';
import { ConflictError, TableError, childChanges, columnLetters, parseTable, planChange, rowCells, saveChildren, sheetRecordTable } from './records';

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
      'Wiersz 3 zakładki „Items” nie ma identyfikatora (ID), więc Kraken go pomija. Czy został wpisany ręcznie?',
      'Wiersz 4 zakładki „Items” ma ten sam identyfikator co wiersz 2, więc Kraken go pomija.',
    ]);
  });

  it('refuses a tab with missing or repeated columns', () => {
    expect(() => parseTable('Items', [['id', 'name']], ['kg'])).toThrow(TableError);
    expect(() => parseTable('Items', [['id', 'name']], ['kg'])).toThrow('brakuje kolumn: created_at, updated_at, created_by, deleted_at, kg');
    expect(() => parseTable('Items', [[...HEADERS, 'name']], [])).toThrow('ma kolumny name więcej niż raz');
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

  it('adds several records in one request, each with its own ID', async () => {
    const { google, table } = setup();
    const stored = await table.addMany([{ name: 'Kenya' }, { name: 'Burundi' }], 'me', t1);
    expect(stored.map((s) => [s.id, s.name])).toEqual([
      ['id-1', 'Kenya'],
      ['id-2', 'Burundi'],
    ]);
    expect(google.requests.filter((r) => r.url.includes(':append'))).toHaveLength(1);
    expect((await table.load()).records.map((r) => r.fields.name)).toEqual(['Kenya', 'Burundi']);
    expect(await table.addMany([], 'me', t1)).toEqual([]);
  });

  it('adds nothing if one of several records is refused', async () => {
    const { google, table } = setup();
    await expect(table.addMany([{ name: 'ok' }, { name: 'x', roast_level: 'light' }], 'me', t1)).rejects.toBeInstanceOf(TableError);
    expect(rowsOf(google)).toEqual([HEADERS]);
  });

  it('changes several records in one write, and only the changed cells', async () => {
    const { google, table } = setup();
    const [a, b, c] = await table.addMany([{ name: 'A', kg: '1' }, { name: 'B', kg: '2' }, { name: 'C', kg: '3' }], 'me', t1);
    if (!a || !b || !c) throw new Error('setup');
    const result = await table.updateMany(
      [
        { id: a.id ?? '', changes: { kg: '10' }, loaded: a },
        { id: c.id ?? '', changes: { name: 'C2', kg: '3' }, loaded: c },
        { id: b.id ?? '', changes: { kg: '2' }, loaded: b }, // unchanged: not written
      ],
      t2,
    );
    expect(result.map((r) => [r.name, r.kg, r.updated_at])).toEqual([
      ['A', '10', t2.toISOString()],
      ['C2', '3', t2.toISOString()],
      ['B', '2', t1.toISOString()],
    ]);
    const writes = google.requests.filter((r) => r.url.endsWith('/values:batchUpdate'));
    expect(writes).toHaveLength(1);
    expect((writes[0]?.body as { data: { range: string }[] }).data.map((d) => d.range)).toEqual(["'Items'!C2", "'Items'!E2", "'Items'!B4", "'Items'!E4"]);
  });

  it('can soft-delete and restore records within the same single write', async () => {
    const { google, table } = setup();
    const [a, b] = await table.addMany([{ name: 'A' }, { name: 'B' }], 'me', t1);
    if (!a || !b) throw new Error('setup');
    const removedB = await table.remove(b.id ?? '', b, t2);
    google.requests.length = 0;
    const result = await table.updateMany(
      [
        { id: a.id ?? '', changes: {}, loaded: a, deleted: true },
        { id: b.id ?? '', changes: { kg: '4' }, loaded: removedB, deleted: false },
      ],
      t3,
    );
    expect(result.map((r) => [r.name, r.kg, r.deleted_at, r.updated_at])).toEqual([
      ['A', '', t3.toISOString(), t3.toISOString()],
      ['B', '4', '', t3.toISOString()],
    ]);
    expect(google.requests.filter((r) => r.url.endsWith('/values:batchUpdate'))).toHaveLength(1);
    expect((await table.load()).records.map((r) => r.fields.deleted_at)).toEqual([t3.toISOString(), '']);
  });

  it('writes nothing at all if one of several edits conflicts', async () => {
    const { google, table } = setup();
    const [a, b] = await table.addMany([{ name: 'A' }, { name: 'B' }], 'me', t1);
    if (!a || !b) throw new Error('setup');
    await table.update(b.id ?? '', { kg: '5' }, b, t2); // someone else's change
    const before = structuredClone(rowsOf(google));
    await expect(
      table.updateMany(
        [
          { id: a.id ?? '', changes: { kg: '1' }, loaded: a },
          { id: b.id ?? '', changes: { kg: '9' }, loaded: b },
        ],
        t3,
      ),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(rowsOf(google)).toEqual(before);
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
    await expect(table.update(a.id ?? '', { created_by: 'someone' }, a, t2)).rejects.toThrow('may not write created_by');
  });

  it('changes only the given fields, in the right row, and keeps columns Kraken does not know', async () => {
    const { google, table } = setup([[...HEADERS, 'owner note']]);
    await table.add({ name: 'Kenya', kg: '60' }, 'me', t1);
    const b = await table.add({ name: 'Burundi', kg: '60' }, 'me', t1);
    const rows = rowsOf(google);
    if (rows?.[2]) rows[2][7] = 'typed in the sheet';

    const changed = await table.update(b.id ?? '', { kg: '59.5' }, b, t2);

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
    await table.update(b.id ?? '', { kg: '1' }, b, t2);
    expect(rowsOf(google)?.[3]?.[2]).toBe('1');
  });

  it('refuses to overwrite a change someone else made since loading (and writes nothing)', async () => {
    const { google, table } = setup();
    const a = await table.add({ name: 'Kenya', kg: '60' }, 'me', t1);
    await table.update(a.id ?? '', { kg: '50' }, a, t2); // the partner's change
    const before = structuredClone(rowsOf(google));

    await expect(table.update(a.id ?? '', { kg: '40' }, a, t3)).rejects.toBeInstanceOf(ConflictError);
    expect(rowsOf(google)).toEqual(before);
  });

  it('refuses to change a record that is gone', async () => {
    const { table } = setup();
    await expect(table.update('nope', { kg: '1' }, {}, t1)).rejects.toThrow('nie ma już w zakładce „Items”');
  });

  it('soft-deletes and restores, keeping the row', async () => {
    const { google, table } = setup();
    const a = await table.add({ name: 'Kenya' }, 'me', t1);
    const deleted = await table.remove(a.id ?? '', a, t2);
    expect(deleted.deleted_at).toBe('2026-11-15T11:00:00.000Z');
    expect(rowsOf(google)).toHaveLength(2);
    expect((await table.load()).records[0]?.fields.deleted_at).toBe('2026-11-15T11:00:00.000Z');

    const restored = await table.restore(a.id ?? '', deleted, t3);
    expect(restored.deleted_at).toBe('');
    expect(restored.name).toBe('Kenya');
  });

  it('refuses to read or write a tab whose columns are missing', async () => {
    const { table } = setup([['id', 'name']]);
    await expect(table.load()).rejects.toBeInstanceOf(TableError);
    await expect(table.add({ name: 'x' }, 'me', t1)).rejects.toBeInstanceOf(TableError);
  });

  it('writes only the changed cells, so formulas and hand-typed values elsewhere in the row stay', async () => {
    const { google, table } = setup([[...HEADERS, 'cost per bag']]);
    const a = await table.add({ name: 'Kenya', kg: '60' }, 'me', t1);
    const row = rowsOf(google)?.[1];
    if (row) row[7] = '=C2/4'; // the owner's own formula column
    await table.update(a.id ?? '', { name: 'Kenya', kg: '59.5' }, a, t2);
    expect(rowsOf(google)?.[1]?.[7]).toBe('=C2/4');
    const write = google.requests.find((r) => r.url.endsWith('/values:batchUpdate'));
    expect((write?.body as { data: { range: string }[] }).data.map((d) => d.range)).toEqual(["'Items'!C2", "'Items'!E2"]);
  });

  it('keeps a correction typed in the sheet meanwhile when the user changed something else', async () => {
    const { google, table } = setup();
    const a = await table.add({ name: 'Kenya', kg: '60' }, 'me', t1);
    const row = rowsOf(google)?.[1];
    if (row) row[2] = '59.5'; // partner fixes kg directly in the sheet; updated_at does not change
    await table.update(a.id ?? '', { name: 'Kenya Kegwa', kg: '60' }, a, t2); // the form still shows 60
    expect(rowsOf(google)?.[1]?.slice(1, 3)).toEqual(['Kenya Kegwa', '59.5']);
  });

  it('refuses when the user changes a cell that was changed by hand meanwhile', async () => {
    const { google, table } = setup();
    const a = await table.add({ name: 'Kenya', kg: '60' }, 'me', t1);
    const row = rowsOf(google)?.[1];
    if (row) row[2] = '59.5';
    const before = structuredClone(rowsOf(google));
    await expect(table.update(a.id ?? '', { kg: '58' }, a, t2)).rejects.toThrow('zmienił w arkuszu kg');
    expect(rowsOf(google)).toEqual(before);
  });

  it('writes nothing when nothing changed', async () => {
    const { google, table } = setup();
    const a = await table.add({ name: 'Kenya', kg: '60' }, 'me', t1);
    const result = await table.update(a.id ?? '', { name: 'Kenya', kg: '60' }, a, t2);
    expect(result.updated_at).toBe(a.updated_at);
    expect(google.requests.some((r) => r.url.endsWith('/values:batchUpdate'))).toBe(false);
  });

  it('finds a record whose ID cell has stray spaces', async () => {
    const { google, table } = setup();
    const a = await table.add({ name: 'Kenya' }, 'me', t1);
    const row = rowsOf(google)?.[1];
    if (row) row[0] = ' id-1 ';
    const [loaded] = (await table.load()).records;
    await table.update('id-1', { kg: '1' }, loaded?.fields ?? {}, t2);
    expect(rowsOf(google)?.[1]?.[2]).toBe('1');
    expect(a.id).toBe('id-1');
  });

  it('refuses fields the tab has no column for, instead of dropping them silently', async () => {
    const { table } = setup();
    await expect(table.add({ name: 'x', roast_level: 'light' }, 'me', t1)).rejects.toThrow('nie ma kolumn roast_level');
    const a = await table.add({ name: 'x' }, 'me', t1);
    await expect(table.update(a.id ?? '', { roast_level: 'light' }, a, t2)).rejects.toBeInstanceOf(TableError);
  });

  it('reports loudly if the row moved to another record while saving', async () => {
    const { google, table } = setup();
    const a = await table.add({ name: 'Kenya' }, 'me', t1);
    await table.add({ name: 'Burundi' }, 'me', t1);
    google.failWhen.push((r) => {
      if (r.url.endsWith('/values:batchUpdate')) rowsOf(google)?.splice(1, 1); // someone deletes row 2 by hand right now
      return undefined;
    });
    await expect(table.update(a.id ?? '', { kg: '1' }, a, t2)).rejects.toThrow('Historia wersji');
  });

  it('adds after the filled rows; a gap typed in the sheet only moves the rows below it', async () => {
    const { google, table } = setup();
    await table.add({ name: 'Kenya' }, 'me', t1);
    rowsOf(google)?.push([], ['id-x', 'Below a gap']);
    await table.add({ name: 'Burundi' }, 'me', t1);
    expect((await table.load()).records.map((r) => r.fields.name)).toEqual(['Kenya', 'Burundi', 'Below a gap']);
  });

  it('reads only the header row when adding', async () => {
    const { google, table } = setup();
    await table.add({ name: 'Kenya' }, 'me', t1);
    expect(google.requests.filter((r) => r.method === 'GET').map((r) => decodeURIComponent(r.url))).toEqual([
      expect.stringContaining("/values/'Items'!1:1"),
    ]);
  });
});

describe('planChange', () => {
  const loaded = { id: 'a', name: 'Kenya', kg: '60', updated_at: 't1' };

  it('writes only what the user changed', () => {
    expect(planChange(loaded, loaded, { name: 'Kenya', kg: '59' })).toEqual({ write: { kg: '59' } });
  });

  it('treats a missing value as empty text', () => {
    expect(planChange(loaded, loaded, { notes: '' })).toEqual({ write: {} });
  });

  it('refuses after a change through Kraken', () => {
    expect(planChange({ ...loaded, updated_at: 't2' }, loaded, { kg: '59' })).toHaveProperty('conflict');
  });

  it('ignores hand changes to cells the user did not change, refuses on cells the user did change', () => {
    const current = { ...loaded, name: 'Kenya AA' };
    expect(planChange(current, loaded, { name: 'Kenya', kg: '59' })).toEqual({ write: { kg: '59' } });
    expect(planChange(current, loaded, { name: 'Kenya Kegwa' })).toEqual({
      conflict: 'Ktoś w międzyczasie zmienił w arkuszu name. Odśwież stronę i spróbuj ponownie.',
    });
  });
});

describe('children (the beans of a product, the lines of a sale)', () => {
  const child = (id: string, fields: Record<string, string>) => ({ id, source: { id, ...fields } });

  it('updates what changed by position, adds new ones and soft-deletes the rest; values compared without spaces around', () => {
    const first = child('A', { name: 'one ', kg: '60' });
    const second = child('B', { name: 'two', kg: '40' });
    expect(childChanges([first, second], [{ name: 'one', kg: '70' }])).toEqual({ updates: [{ child: first, changes: { kg: '70' } }], adds: [], removes: [second] });
    expect(childChanges([first], [{ name: 'one', kg: '60' }, { name: 'new', kg: '1' }])).toEqual({ updates: [], adds: [{ name: 'new', kg: '1' }], removes: [] });
  });

  it('saves them: new ones get the parent ID, changes are written, the rest soft-deleted; asks who only when adding', async () => {
    const { table } = setup([[...HEADERS, 'parent_id']]);
    let asked = 0;
    const by = async () => (asked++, 'partner@example.com');
    await saveChildren(table, 'parent_id', 'P1', [], [{ name: 'one', kg: '1' }, { name: 'two', kg: '2' }], by, t1);
    let loaded = (await table.load()).records.map((r) => ({ id: r.fields['id'] ?? '', source: r.fields }));
    expect(loaded.map((c) => [c.source['name'], c.source['parent_id'], c.source['created_by']])).toEqual([
      ['one', 'P1', 'partner@example.com'],
      ['two', 'P1', 'partner@example.com'],
    ]);
    await saveChildren(table, 'parent_id', 'P1', loaded, [{ name: 'one', kg: '5' }], by, t2);
    loaded = (await table.load()).records.map((r) => ({ id: r.fields['id'] ?? '', source: r.fields }));
    expect(loaded.map((c) => [c.source['kg'], c.source['deleted_at']])).toEqual([
      ['5', ''],
      ['2', t2.toISOString()],
    ]);
    expect(asked).toBe(1);
  });
});
