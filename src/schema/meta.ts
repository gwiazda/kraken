// The `_meta` tab: a small key/value table that says which version of the data structure the sheet has.
// Migrations (structure changes) are checked against it, see "Data safety" in CLAUDE.md.

/** Name of the technical tab. */
export const META_TAB = '_meta';

/**
 * The data structure version this app version expects: the version of the last migration in `migrations.ts`
 * (a test checks they match). Raise it only together with a new migration and its tests.
 */
export const APP_SCHEMA_VERSION = 2;

/**
 * Every new spreadsheet starts at version 1 (only `_meta`) and is brought up to date by the same migrations as an
 * existing sheet, so there is one single description of the structure.
 */
export const BASE_SCHEMA_VERSION = 1;

/** Marker that identifies a Kraken spreadsheet. */
export const APP_MARKER = 'Kraken';

/** Rows written to `_meta` when Kraken creates a new spreadsheet (version 1; migrations then run). */
export function initialMetaRows(createdAt: Date): string[][] {
  return [
    ['key', 'value'],
    ['app', APP_MARKER],
    ['schema_version', String(BASE_SCHEMA_VERSION)],
    ['created_at', createdAt.toISOString()],
  ];
}

/** What Kraken found when it read the `_meta` tab of a spreadsheet. */
export type MetaCheck =
  | { kind: 'ok'; schemaVersion: number }
  /** The sheet is older than this app: a migration (with a backup copy first) is needed. */
  | { kind: 'needs-migration'; schemaVersion: number }
  /** The sheet was written by a newer Kraken: this page is out of date and must not write to it. */
  | { kind: 'app-outdated'; schemaVersion: number }
  /** No `_meta` tab, or it is not a Kraken `_meta` tab. */
  | { kind: 'not-kraken' };

/** Reads `_meta` rows (as returned by the Sheets API, header row included) and decides whether the sheet is usable. */
export function checkMeta(rows: readonly (readonly unknown[])[] | undefined, appVersion = APP_SCHEMA_VERSION): MetaCheck {
  if (!rows) return { kind: 'not-kraken' };
  const values = new Map<string, string>();
  for (const row of rows) {
    const key = row[0];
    const value = row[1];
    if (typeof key === 'string' && value !== undefined && value !== null) {
      values.set(key.trim(), String(value).trim());
    }
  }
  if (values.get('app') !== APP_MARKER) return { kind: 'not-kraken' };

  const raw = values.get('schema_version') ?? '';
  if (!/^\d+$/.test(raw)) return { kind: 'not-kraken' };
  const schemaVersion = Number(raw);
  if (schemaVersion < 1) return { kind: 'not-kraken' };

  if (schemaVersion === appVersion) return { kind: 'ok', schemaVersion };
  if (schemaVersion < appVersion) return { kind: 'needs-migration', schemaVersion };
  return { kind: 'app-outdated', schemaVersion };
}

/**
 * The cell that holds `schema_version` (e.g. `B3`), found by its key like `checkMeta` does.
 * Returns null if the key is missing or appears more than once (then Kraken must not guess which one to change).
 */
export function schemaVersionCell(rows: readonly (readonly unknown[])[]): string | null {
  const found = rows.flatMap((row, index) => (typeof row[0] === 'string' && row[0].trim() === 'schema_version' ? [index] : []));
  return found.length === 1 && found[0] !== undefined ? `B${found[0] + 1}` : null;
}
