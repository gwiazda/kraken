import { describe, expect, it } from 'vitest';
import { newSpreadsheetBody } from '../core/sheets';
import { fakeClient } from '../testing/fakeGoogle';
import { createKrakenSpreadsheet, describeMetaProblem, inspectSpreadsheet, readMetaRows } from './connect';
import { META_TAB, checkMeta, initialMetaRows } from './meta';

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
    const client = fakeClient([{ body: resource }, { body: { values: [['app', 'Kraken'], ['schema_version', '1']] } }]);
    const result = await inspectSpreadsheet(client, ID);
    expect(result.info.title).toBe('Kraken');
    expect(result.meta).toEqual({ kind: 'ok', schemaVersion: 1 });
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
  it('creates the spreadsheet with a filled _meta tab in a single request', async () => {
    const client = fakeClient([{ body: resource }]);
    const info = await createKrakenSpreadsheet(client, 'Kraken', created);

    expect(info).toEqual({ id: ID, title: 'Kraken', url: resource.spreadsheetUrl, tabs: ['_meta'] });
    expect(client.requests).toHaveLength(1);
    const [request] = client.requests;
    expect(request?.method).toBe('POST');
    expect(request?.url).toMatch(/^https:\/\/sheets\.googleapis\.com\/v4\/spreadsheets\?/);
    expect(request?.headers.get('Authorization')).toBe('Bearer test-token');
    expect(request?.body).toEqual(newSpreadsheetBody('Kraken', { title: META_TAB, rows: initialMetaRows(created) }));
  });

  it('sends _meta rows that Kraken itself accepts as an up-to-date sheet', async () => {
    const client = fakeClient([{ body: resource }]);
    await createKrakenSpreadsheet(client, 'Kraken', created);
    const body = client.requests[0]?.body as {
      sheets: { properties: { title: string }; data: { rowData: { values: { userEnteredValue: { stringValue: string } }[] }[] }[] }[];
    };
    expect(body.sheets).toHaveLength(1);
    const sheet = body.sheets[0];
    expect(sheet?.properties.title).toBe(META_TAB);
    const rows = sheet?.data[0]?.rowData.map((row) => row.values.map((cell) => cell.userEnteredValue.stringValue));
    expect(checkMeta(rows).kind).toBe('ok');
    expect(rows).toContainEqual(['created_at', '2026-01-15T10:00:00.000Z']);
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
