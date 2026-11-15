// Runs migrations on a Kraken spreadsheet (owner's rule, CLAUDE.md "Data safety"):
// 1. full backup copy, checked (same tabs, rows and headers); 2. the migration's steps; 3. check no rows were lost and the new
// headers are there; 4. only then raise `schema_version`. Every step is safe to run again after a failure.

import { copyFile } from '../core/drive';
import { addTab, getSpreadsheetInfo, readTabs, writeValues, type InitialTab, type SheetsClient } from '../core/sheets';
import { APP_SCHEMA_VERSION, BASE_SCHEMA_VERSION, META_TAB, checkMeta, initialMetaRows, schemaVersionCell } from './meta';
import type { Migration, MigrationStep } from './migrationTypes';
import { MIGRATIONS } from './migrations';

/** The spreadsheet operations a migration needs. The real one talks to Google; tests use an in-memory sheet. */
export interface SheetOps {
  /** Names of the tabs, in order. */
  tabs(id: string): Promise<string[]>;
  /** The rows of each tab, in the order asked. */
  readTabs(id: string, tabs: readonly string[]): Promise<unknown[][][]>;
  addTab(id: string, tab: string, headers: readonly string[]): Promise<void>;
  writeValues(id: string, tab: string, cells: string, values: string[][]): Promise<void>;
  /** Full copy of the spreadsheet in Drive; returns the copy's ID. */
  copyFile(id: string, name: string): Promise<string>;
}

export function googleSheetOps(client: SheetsClient): SheetOps {
  return {
    tabs: async (id) => (await getSpreadsheetInfo(client, id)).tabs,
    readTabs: (id, tabs) => readTabs(client, id, tabs),
    addTab: (id, tab, headers) => addTab(client, id, tab, headers),
    writeValues: (id, tab, cells, values) => writeValues(client, id, tab, cells, values),
    copyFile: (id, name) => copyFile(client, id, name),
  };
}

/** A migration stopped. The message says what happened and that the data is safe; `backupName` if a backup was made. */
export class MigrationError extends Error {
  readonly backupName: string | null;
  constructor(message: string, backupName: string | null) {
    super(message);
    this.name = 'MigrationError';
    this.backupName = backupName;
  }
}

export interface MigrateOptions {
  /** Make and check a backup copy first. Only a brand-new, empty sheet is migrated without one. */
  backup: boolean;
  now?: Date;
  onProgress?: (text: string) => void;
  /** For tests. */
  migrations?: readonly Migration[];
  appVersion?: number;
}

export interface MigrateResult {
  fromVersion: number;
  toVersion: number;
  backupName: string | null;
}

/** "Kraken backup 2026-11-15 (before v2)", using the local date. */
export function backupName(now: Date, nextVersion: number): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `Kraken backup ${date} (before v${nextVersion})`;
}

/** Rows that have at least one filled cell. */
export function countRows(rows: readonly (readonly unknown[])[]): number {
  return rows.filter((row) => row.some((cell) => cell !== null && cell !== undefined && String(cell).trim() !== '')).length;
}

/** The migrations that bring a sheet from `fromVersion` to `appVersion`, checked to be complete and in order. */
export function pendingMigrations(all: readonly Migration[], fromVersion: number, appVersion: number): Migration[] {
  const pending = all.filter((m) => m.toVersion > fromVersion && m.toVersion <= appVersion).sort((a, b) => a.toVersion - b.toVersion);
  pending.forEach((m, index) => {
    if (m.toVersion !== fromVersion + index + 1) throw new Error(`Migration to version ${fromVersion + index + 1} is missing`);
  });
  if (appVersion > fromVersion && pending.length !== appVersion - fromVersion) {
    throw new Error(`Migrations up to version ${appVersion} are missing`);
  }
  return pending;
}

const sameHeaders = (row: readonly unknown[] | undefined, headers: readonly string[]) =>
  row !== undefined && row.length === headers.length && headers.every((header, i) => String(row[i] ?? '').trim() === header);

export async function migrateSpreadsheet(ops: SheetOps, id: string, options: MigrateOptions): Promise<MigrateResult> {
  const appVersion = options.appVersion ?? APP_SCHEMA_VERSION;
  const progress = options.onProgress ?? (() => {});
  let backup: string | null = null;
  const stop: (message: string) => never = (message) => {
    throw new MigrationError(message, backup);
  };

  // Read everything first: the version and how many rows each tab has. Anything wrong stops here, before a backup.
  const tabs = await ops.tabs(id);
  if (!tabs.includes(META_TAB)) stop('This is not a Kraken sheet. Nothing was changed.');
  const contents = await ops.readTabs(id, tabs);
  const metaIndex = tabs.indexOf(META_TAB);
  const metaRows = contents[metaIndex] ?? [];
  const meta = checkMeta(metaRows, appVersion);
  if (meta.kind === 'ok') return { fromVersion: meta.schemaVersion, toVersion: meta.schemaVersion, backupName: null };
  if (meta.kind !== 'needs-migration') stop('This sheet cannot be updated by this version of Kraken. Nothing was changed.');
  const fromVersion = meta.schemaVersion;
  const versionCell = schemaVersionCell(metaRows) ?? stop('The _meta tab has no single schema_version row, so Kraken did not change anything.');
  const pending = pendingMigrations(options.migrations ?? MIGRATIONS, fromVersion, appVersion);
  const rowsBefore = contents.map(countRows);

  // 1. Backup copy, checked before anything is changed: same tabs, same number of rows, same header rows.
  //    (Not every cell: formulas like =TODAY() can show a different value in the copy.)
  if (options.backup) {
    const name = backupName(options.now ?? new Date(), fromVersion + 1);
    progress(`Making a backup copy "${name}"…`);
    const copyId = await ops.copyFile(id, name);
    backup = name;
    progress('Checking the backup copy…');
    const copyTabs = await ops.tabs(copyId);
    const copyContents = await ops.readTabs(copyId, copyTabs);
    const matches =
      JSON.stringify(copyTabs) === JSON.stringify(tabs) &&
      copyContents.every((rows, i) => countRows(rows) === rowsBefore[i] && JSON.stringify(rows[0] ?? []) === JSON.stringify(contents[i]?.[0] ?? []));
    if (!matches) stop(`The backup copy "${name}" does not match the sheet, so Kraken stopped. Nothing in your sheet was changed.`);
  }

  for (const migration of pending) {
    const safe = backup ? ` Your backup "${backup}" is in your Google Drive.` : '';
    const notRaised = `The sheet stays at data version ${migration.toVersion - 1}.${safe} Click "Update now" to try again.`;

    // 2. The steps.
    progress(`Updating to data version ${migration.toVersion}: ${migration.description}…`);
    for (const step of migration.steps) await applyStep(ops, id, step, notRaised, stop);

    // 3. Check, in one read: the old tabs have the same number of rows, and the new tabs have their headers.
    const newTabs = migration.steps.map((step) => step.tab);
    const after = await ops.readTabs(id, [...tabs, ...newTabs]);
    tabs.forEach((tab, i) => {
      if (countRows(after[i] ?? []) !== rowsBefore[i]) stop(`Tab "${tab}" has a different number of rows after the update. ${notRaised}`);
    });
    migration.steps.forEach((step, i) => {
      if (!sameHeaders(after[tabs.length + i]?.[0], step.headers)) stop(`Tab "${step.tab}" is missing its column headers. ${notRaised}`);
    });

    // 4. Raise the version, unless someone else changed it meanwhile.
    const current = checkMeta(after[metaIndex], appVersion);
    if (current.kind === 'ok') break; // the other person finished the whole update meanwhile
    if (current.kind !== 'needs-migration' || current.schemaVersion < migration.toVersion - 1) {
      stop(`The sheet's data version changed while updating. Reload the page with Cmd+Shift+R.${safe}`);
    }
    if (current.schemaVersion >= migration.toVersion) continue; // the other person already did this one
    await ops.writeValues(id, META_TAB, versionCell, [[String(migration.toVersion)]]);
    const [check] = await ops.readTabs(id, [META_TAB]);
    if (checkMeta(check, migration.toVersion).kind !== 'ok') stop(`The new data version could not be saved. ${notRaised}`);
  }

  progress('Update finished.');
  return { fromVersion, toVersion: appVersion, backupName: backup };
}

/**
 * The tabs of a brand-new Kraken sheet: `_meta` at the app's version plus every tab the migrations add, so a new
 * sheet is created in one all-or-nothing request and still has exactly the structure the migrations describe.
 */
export function initialTabs(createdAt: Date, all: readonly Migration[] = MIGRATIONS, appVersion = APP_SCHEMA_VERSION): InitialTab[] {
  const tabs: InitialTab[] = [{ title: META_TAB, rows: initialMetaRows(createdAt, appVersion) }];
  for (const migration of pendingMigrations(all, BASE_SCHEMA_VERSION, appVersion)) {
    for (const step of migration.steps) {
      switch (step.kind) {
        case 'add-tab':
          tabs.push({ title: step.tab, rows: [[...step.headers]], frozenRows: 1 });
          break;
        default: {
          const unknown: never = step.kind;
          throw new Error(`initialTabs does not know step ${String(unknown)}`);
        }
      }
    }
  }
  return tabs;
}

async function applyStep(ops: SheetOps, id: string, step: MigrationStep, notRaised: string, stop: (message: string) => never): Promise<void> {
  const tabs = await ops.tabs(id);
  if (!tabs.includes(step.tab)) {
    await ops.addTab(id, step.tab, step.headers);
    return;
  }
  // Already there: fine if a previous attempt added it, but never touch a tab someone made by hand.
  const [rows] = await ops.readTabs(id, [step.tab]);
  if (!sameHeaders(rows?.[0], step.headers) || countRows(rows ?? []) > 1) {
    stop(`The sheet already has a "${step.tab}" tab that Kraken did not make. Rename that tab in Google Sheets, then try again. ${notRaised}`);
  }
}

/** What "Update now" will do, for the update screen: the changes, in order, and the backup copy's name. */
export function updatePlan(fromVersion: number, now = new Date(), all: readonly Migration[] = MIGRATIONS, appVersion = APP_SCHEMA_VERSION) {
  const pending = pendingMigrations(all, fromVersion, appVersion);
  return {
    toVersion: appVersion,
    changes: pending.map((m) => `Data version ${m.toVersion}: ${m.description}`),
    backupName: backupName(now, fromVersion + 1),
  };
}
