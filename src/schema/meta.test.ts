import { describe, expect, it } from 'vitest';
import { APP_MARKER, APP_SCHEMA_VERSION, checkMeta, initialMetaRows } from './meta';

const created = new Date('2026-01-15T10:00:00.000Z');

describe('initialMetaRows', () => {
  it('writes a header, the Kraken marker, the current schema version and the creation time', () => {
    expect(initialMetaRows(created)).toEqual([
      ['key', 'value'],
      ['app', APP_MARKER],
      ['schema_version', String(APP_SCHEMA_VERSION)],
      ['created_at', '2026-01-15T10:00:00.000Z'],
    ]);
  });

  it('is accepted by checkMeta as an up-to-date Kraken sheet (what we write is what we read)', () => {
    expect(checkMeta(initialMetaRows(created))).toEqual({ kind: 'ok', schemaVersion: APP_SCHEMA_VERSION });
  });
});

describe('checkMeta', () => {
  const rows = (version: unknown, app: unknown = 'Kraken') => [
    ['key', 'value'],
    ['app', app],
    ['schema_version', version],
  ];

  it('accepts a sheet with the same version as the app', () => {
    expect(checkMeta(rows('3'), 3)).toEqual({ kind: 'ok', schemaVersion: 3 });
  });

  it('asks for a migration when the sheet is older than the app', () => {
    expect(checkMeta(rows('2'), 3)).toEqual({ kind: 'needs-migration', schemaVersion: 2 });
  });

  it('refuses to work when the sheet is newer than the app (an old page must not write to it)', () => {
    expect(checkMeta(rows('4'), 3)).toEqual({ kind: 'app-outdated', schemaVersion: 4 });
  });

  it('accepts numbers as well as text for the version', () => {
    expect(checkMeta(rows(1), 1)).toEqual({ kind: 'ok', schemaVersion: 1 });
  });

  it('ignores extra spaces and the order of rows', () => {
    expect(checkMeta([[' schema_version ', ' 1 '], ['other', 'x'], ['app', ' Kraken ']], 1)).toEqual({ kind: 'ok', schemaVersion: 1 });
  });

  it.each([
    ['no _meta tab', undefined],
    ['an empty _meta tab', []],
    ['another app', rows('1', 'Something else')],
    ['a missing version', [['app', 'Kraken']]],
    ['a version that is not a whole number', rows('1.5')],
    ['a negative version', rows('-1')],
    ['version 0', rows('0')],
    ['a version that is text', rows('one')],
    ['rows with missing values', [['app'], ['schema_version']]],
  ])('reports "not a Kraken sheet" for %s', (_name, input) => {
    expect(checkMeta(input as unknown[][] | undefined, 1)).toEqual({ kind: 'not-kraken' });
  });
});
