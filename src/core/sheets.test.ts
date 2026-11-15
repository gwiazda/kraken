import { describe, expect, it } from 'vitest';
import { SheetsError, createSpreadsheet, errorKindForStatus, getSpreadsheetInfo, isGoogleSheetsUrl, newSpreadsheetBody, readValues, tabRange, type SheetsClient } from './sheets';
import { fakeClient } from '../testing/fakeGoogle';

const ID = 'sheet-id-made-up-1234567890';
const resource = {
  spreadsheetId: ID,
  spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${ID}/edit`,
  properties: { title: 'Kraken' },
  sheets: [{ properties: { title: '_meta' } }, { properties: { title: 'Lots' } }],
};

describe('createSpreadsheet', () => {
  const tab = { title: 'First', rows: [['a', 'b'], ['1', '2']] };

  it('creates the spreadsheet with its first tab filled, in a single request', async () => {
    const client = fakeClient([{ body: resource }]);
    const info = await createSpreadsheet(client, 'Kraken', tab);

    expect(info).toEqual({ id: ID, title: 'Kraken', url: resource.spreadsheetUrl, tabs: ['_meta', 'Lots'] });
    expect(client.requests).toHaveLength(1);
    const [request] = client.requests;
    expect(request?.method).toBe('POST');
    expect(request?.url).toMatch(/^https:\/\/sheets\.googleapis\.com\/v4\/spreadsheets\?/);
    expect(request?.headers.get('Authorization')).toBe('Bearer test-token');
    expect(request?.body).toEqual(newSpreadsheetBody('Kraken', tab));
  });

  it('writes every cell as plain text (so Google never reinterprets it)', () => {
    expect(newSpreadsheetBody('Kraken', tab)).toEqual({
      properties: { title: 'Kraken' },
      sheets: [
        {
          properties: { title: 'First' },
          data: [
            {
              startRow: 0,
              startColumn: 0,
              rowData: [
                { values: [{ userEnteredValue: { stringValue: 'a' } }, { userEnteredValue: { stringValue: 'b' } }] },
                { values: [{ userEnteredValue: { stringValue: '1' } }, { userEnteredValue: { stringValue: '2' } }] },
              ],
            },
          ],
        },
      ],
    });
  });
});

describe('getSpreadsheetInfo', () => {
  it('returns the tab names', async () => {
    const info = await getSpreadsheetInfo(fakeClient([{ body: resource }]), ID);
    expect(info.tabs).toEqual(['_meta', 'Lots']);
  });

  it('copes with a reply without tabs', async () => {
    const { sheets: _ignored, ...withoutTabs } = resource;
    const info = await getSpreadsheetInfo(fakeClient([{ body: withoutTabs }]), ID);
    expect(info.tabs).toEqual([]);
  });

  it('asks only for the fields it needs, for the right spreadsheet', async () => {
    const client = fakeClient([{ body: resource }]);
    await getSpreadsheetInfo(client, ID);
    expect(client.requests[0]?.url).toBe(
      `https://sheets.googleapis.com/v4/spreadsheets/${ID}?fields=spreadsheetId,spreadsheetUrl,properties.title,sheets.properties.title`,
    );
    expect(client.requests[0]?.method).toBe('GET');
  });
});

describe('readValues', () => {
  it('reads the cells of a tab', async () => {
    const values = [['key', 'value'], ['app', 'Kraken']];
    const client = fakeClient([{ body: { values } }]);
    expect(await readValues(client, ID, 'Lots', 'A1:C10')).toEqual(values);
    expect(decodeURIComponent(client.requests[0]?.url ?? '')).toContain(`/${ID}/values/'Lots'!A1:C10`);
  });

  it('returns an empty list when the tab is empty', async () => {
    expect(await readValues(fakeClient([{ body: {} }]), ID, 'Lots', 'A1:C10')).toEqual([]);
  });

  it('passes every error on, including 400', async () => {
    const client = fakeClient([{ status: 400, body: { error: { message: 'Bad request' } } }]);
    await expect(readValues(client, ID, 'Lots', 'A1:C10')).rejects.toMatchObject({ status: 400 });
  });
});

describe('tabRange', () => {
  it.each([
    ['_meta', 'A1:B100', "'_meta'!A1:B100"],
    ['Bag sizes', 'A:Z', "'Bag sizes'!A:Z"],
    ["Owner's notes", 'A1', "'Owner''s notes'!A1"],
  ])('%s %s -> %s', (tab, cells, expected) => {
    expect(tabRange(tab, cells)).toBe(expected);
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
