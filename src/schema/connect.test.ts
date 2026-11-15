import { describe, expect, it } from 'vitest';
import { newSpreadsheetBody } from '../core/sheets';
import { fakeClient } from '../testing/fakeGoogle';
import { fakeGoogleDrive } from '../testing/fakeGoogleDrive';
import { createKrakenSpreadsheet, describeMetaProblem, inspectSpreadsheet, readMetaRows, updateSpreadsheet } from './connect';
import { APP_SCHEMA_VERSION, META_TAB, checkMeta, initialMetaRows } from './meta';

const ID = 'sheet-id-made-up-1234567890';
const resource = {
  spreadsheetId: ID,
  spreadsheetUrl: 'https://docs.google.com/x',
  properties: { title: 'Kraken' },
  sheets: [{ properties: { title: '_meta' } }],
};
const created = new Date('2026-01-15T10:00:00.000Z');
const noMetaTab = { ...resource, sheets: [{ properties: { title: 'Sheet1' } }] };

describe('inspectSpreadsheet', () => {
  it('accepts a Kraken sheet with the current data version', async () => {
    const client = fakeClient([{ body: resource }, { body: { values: [['app', 'Kraken'], ['schema_version', String(APP_SCHEMA_VERSION)]] } }]);
    const result = await inspectSpreadsheet(client, ID);
    expect(result.info.title).toBe('Kraken');
    expect(result.meta).toEqual({ kind: 'ok', schemaVersion: APP_SCHEMA_VERSION });
  });

  it('recognises a spreadsheet without a _meta tab as not a Kraken sheet, from the tab list alone', async () => {
    const client = fakeClient([{ body: noMetaTab }]);
    expect((await inspectSpreadsheet(client, ID)).meta).toEqual({ kind: 'not-kraken' });
    expect(client.requests).toHaveLength(1);
  });

  it('reports a Google error while reading _meta as an error, not as "not a Kraken sheet"', async () => {
    const client = fakeClient([{ body: resource }, { status: 400, body: { error: { message: 'Bad request' } } }]);
    await expect(inspectSpreadsheet(client, ID)).rejects.toMatchObject({ status: 400 });
  });

  it('only reads: it never sends a write request', async () => {
    const client = fakeClient([{ body: resource }, { body: { values: [['app', 'Kraken'], ['schema_version', '1']] } }]);
    await inspectSpreadsheet(client, ID);
    expect(client.requests.map((r) => r.method)).toEqual(['GET', 'GET']);
  });
});

describe('describeMetaProblem', () => {
  it('has no problem for an ok sheet', () => {
    expect(describeMetaProblem({ kind: 'ok', schemaVersion: 1 })).toBeNull();
  });

  it.each([
    [{ kind: 'not-kraken' } as const, 'not a Kraken sheet'],
    [{ kind: 'app-outdated', schemaVersion: 7 } as const, 'newer version of Kraken'],
    [{ kind: 'needs-migration', schemaVersion: 0 } as const, 'backup copy first'],
  ])('explains %o', (meta, text) => {
    expect(describeMetaProblem(meta)).toContain(text);
  });
});

describe('createKrakenSpreadsheet', () => {
  it('creates _meta at version 1 in one request, then runs the migrations (no backup: the sheet is new)', async () => {
    const google = fakeGoogleDrive();
    const info = await createKrakenSpreadsheet(google, 'Kraken', created);

    const [first] = google.requests;
    expect(first?.method).toBe('POST');
    expect(first?.url).toMatch(/^https:\/\/sheets\.googleapis\.com\/v4\/spreadsheets\?/);
    expect(first?.body).toEqual(newSpreadsheetBody('Kraken', { title: META_TAB, rows: initialMetaRows(created) }));
    expect(google.requests.some((r) => r.url.includes('/copy'))).toBe(false);
    expect(google.files.size).toBe(1);

    const rows = await readMetaRows(google, info.id);
    expect(checkMeta(rows)).toEqual({ kind: 'ok', schemaVersion: APP_SCHEMA_VERSION });
    expect(rows).toContainEqual(['created_at', '2026-01-15T10:00:00.000Z']);
    expect((await inspectSpreadsheet(google, info.id)).meta.kind).toBe('ok');
    expect(google.files.get(info.id)?.tabs.map((t) => t.title)).toEqual(['_meta', 'Lots']);
  });
});

describe('updateSpreadsheet', () => {
  it('backs up, then brings an existing version 1 sheet up to date', async () => {
    const google = fakeGoogleDrive();
    google.addFile(ID, { name: 'Kraken', tabs: [{ title: META_TAB, sheetId: 0, rows: initialMetaRows(created) }] });
    const progress: string[] = [];
    const result = await updateSpreadsheet(google, ID, (text) => progress.push(text));

    expect(result.fromVersion).toBe(1);
    expect(result.toVersion).toBe(APP_SCHEMA_VERSION);
    expect(result.backupName).toMatch(/^Kraken backup \d{4}-\d{2}-\d{2} \(before v2\)$/);
    expect(google.files.size).toBe(2);
    expect(progress[0]).toContain('backup copy');
    expect((await inspectSpreadsheet(google, ID)).meta).toEqual({ kind: 'ok', schemaVersion: APP_SCHEMA_VERSION });
  });
});

describe('readMetaRows', () => {
  it('reads the _meta tab', async () => {
    const values = [['key', 'value'], ['app', 'Kraken']];
    const client = fakeClient([{ body: { values } }]);
    expect(await readMetaRows(client, ID)).toEqual(values);
    expect(decodeURIComponent(client.requests[0]?.url ?? '')).toContain(`/values/'_meta'!A1:B100`);
  });

  it('returns an empty list when the tab is empty', async () => {
    expect(await readMetaRows(fakeClient([{ body: {} }]), ID)).toEqual([]);
  });

  it('passes every error on, including 400 (never guesses "not a Kraken sheet" from an error)', async () => {
    const client = fakeClient([{ status: 400, body: { error: { message: 'Bad request' } } }]);
    await expect(readMetaRows(client, ID)).rejects.toMatchObject({ status: 400 });
  });

  it('passes access errors on', async () => {
    const client = fakeClient([{ status: 403, body: { error: { message: 'denied' } } }]);
    await expect(readMetaRows(client, ID)).rejects.toMatchObject({ kind: 'no-access', status: 403 });
  });
});
