import { describe, expect, it } from 'vitest';
import { describeMetaProblem, inspectSpreadsheet } from './connect';
import { fakeClient } from './testing/fakeGoogle';

const ID = 'sheet-id-made-up-1234567890';
const resource = {
  spreadsheetId: ID,
  spreadsheetUrl: 'https://docs.google.com/x',
  properties: { title: 'Kraken' },
  sheets: [{ properties: { title: '_meta' } }],
};
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
