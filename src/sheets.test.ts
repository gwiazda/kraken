import { describe, expect, it } from 'vitest';
import { META_TAB, checkMeta } from './meta';
import { SheetsError, createSpreadsheet, errorKindForStatus, getSpreadsheetInfo, isGoogleSheetsUrl, newSpreadsheetBody, readMetaRows, type SheetsClient } from './sheets';
import { fakeClient } from './testing/fakeGoogle';

const ID = 'sheet-id-made-up-1234567890';
const resource = { spreadsheetId: ID, spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${ID}/edit`, properties: { title: 'Kraken' } };
const created = new Date('2026-01-15T10:00:00.000Z');

describe('createSpreadsheet', () => {
  it('creates the spreadsheet with a filled _meta tab in a single request', async () => {
    const client = fakeClient([{ body: resource }]);
    const info = await createSpreadsheet(client, 'Kraken', created);

    expect(info).toEqual({ id: ID, title: 'Kraken', url: resource.spreadsheetUrl });
    expect(client.requests).toHaveLength(1);
    const [request] = client.requests;
    expect(request?.method).toBe('POST');
    expect(request?.url).toMatch(/^https:\/\/sheets\.googleapis\.com\/v4\/spreadsheets\?/);
    expect(request?.headers.get('Authorization')).toBe('Bearer test-token');
    expect(request?.body).toEqual(newSpreadsheetBody('Kraken', created));
  });

  it('writes _meta rows that Kraken itself accepts as an up-to-date sheet', () => {
    const body = newSpreadsheetBody('Kraken', created) as {
      sheets: { properties: { title: string }; data: { rowData: { values: { userEnteredValue: { stringValue: string } }[] }[] }[] }[];
    };
    const sheet = body.sheets[0];
    expect(sheet?.properties.title).toBe(META_TAB);
    const rows = sheet?.data[0]?.rowData.map((row) => row.values.map((cell) => cell.userEnteredValue.stringValue));
    expect(checkMeta(rows).kind).toBe('ok');
  });
});

describe('getSpreadsheetInfo', () => {
  it('asks only for the fields it needs, for the right spreadsheet', async () => {
    const client = fakeClient([{ body: resource }]);
    await getSpreadsheetInfo(client, ID);
    expect(client.requests[0]?.url).toBe(
      `https://sheets.googleapis.com/v4/spreadsheets/${ID}?fields=spreadsheetId,spreadsheetUrl,properties.title`,
    );
    expect(client.requests[0]?.method).toBe('GET');
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

  it('returns undefined when the spreadsheet has no _meta tab', async () => {
    const client = fakeClient([{ status: 400, body: { error: { message: 'Unable to parse range' } } }]);
    expect(await readMetaRows(client, ID)).toBeUndefined();
  });

  it('passes other errors on', async () => {
    const client = fakeClient([{ status: 403, body: { error: { message: 'denied' } } }]);
    await expect(readMetaRows(client, ID)).rejects.toMatchObject({ kind: 'no-access', status: 403 });
  });
});

describe('errors', () => {
  it.each([
    [401, 'signed-out'],
    [403, 'no-access'],
    [404, 'no-access'],
    [429, 'rate-limited'],
    [500, 'other'],
  ])('status %i -> %s', (status, kind) => {
    expect(errorKindForStatus(status)).toBe(kind);
  });

  it("includes Google's message", async () => {
    const client = fakeClient([{ status: 500, body: { error: { message: 'Backend error' } } }]);
    await expect(getSpreadsheetInfo(client, ID)).rejects.toThrow('Backend error');
  });

  it('copes with an error reply that is not JSON', async () => {
    const client: SheetsClient = { getToken: () => 't', fetch: async () => new Response('oops', { status: 502, statusText: 'Bad Gateway' }) };
    await expect(getSpreadsheetInfo(client, ID)).rejects.toBeInstanceOf(SheetsError);
  });

  it('does not call Google at all when the user is signed out', async () => {
    const client = fakeClient([]);
    client.getToken = () => {
      throw new SheetsError('signed-out', 401, 'Not signed in');
    };
    await expect(getSpreadsheetInfo(client, ID)).rejects.toMatchObject({ kind: 'signed-out' });
    expect(client.requests).toHaveLength(0);
  });
});

describe('isGoogleSheetsUrl', () => {
  it.each([
    ['https://docs.google.com/spreadsheets/d/abc/edit', true],
    ['http://docs.google.com/spreadsheets/d/abc/edit', false],
    ['javascript:alert(1)', false],
    ['https://docs.google.com.evil.example/x', false],
    ['https://evil.example/docs.google.com', false],
    ['not a url', false],
  ])('%s -> %s', (url, ok) => {
    expect(isGoogleSheetsUrl(url)).toBe(ok);
  });
});
