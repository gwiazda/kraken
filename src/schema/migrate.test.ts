import { describe, expect, it } from 'vitest';
import { SheetsError } from '../core/sheets';
import { fakeGoogleDrive, type FakeDrive, type FakeFile } from '../testing/fakeGoogleDrive';
import { APP_SCHEMA_VERSION, META_TAB, initialMetaRows } from './meta';
import { MigrationError, backupName, countRows, googleSheetOps, initialTabs, migrateSpreadsheet, pendingMigrations, updatePlan, type MigrateOptions } from './migrate';
import type { Migration } from './migrationTypes';
import { MIGRATIONS } from './migrations';

const ID = 'fake-original-sheet-0000000001';
const created = new Date('2026-01-15T10:00:00.000Z');
const now = new Date(2026, 10, 15, 12, 0); // local time: 15 November 2026

const addA: Migration = { toVersion: 2, description: 'adds A', steps: [{ kind: 'add-tab', tab: 'A', headers: ['id', 'name'] }] };
const addB: Migration = { toVersion: 3, description: 'adds B', steps: [{ kind: 'add-tab', tab: 'B', headers: ['id', 'kg'] }] };

function metaRows(version: number): string[][] {
  return initialMetaRows(created, version);
}

/** A Kraken sheet at `version`, plus a tab with real rows that must never be touched. */
function sheetAt(version: number, extra: FakeFile['tabs'] = []): FakeDrive {
  const google = fakeGoogleDrive();
  google.addFile(ID, {
    name: 'Kraken',
    tabs: [
      { title: META_TAB, sheetId: 0, rows: [...metaRows(version), ['note', 'keep me']] },
      { title: 'Owner notes', sheetId: 7, rows: [['what', 'when'], ['roast Kenya', '2026-11-10'], ['', ''], ['call supplier', '2026-11-12']] },
      ...extra,
    ],
  });
  return google;
}

const run = (google: FakeDrive, options: Partial<MigrateOptions> = {}) =>
  migrateSpreadsheet(googleSheetOps(google), ID, { backup: true, now, migrations: [addA, addB], appVersion: 3, ...options });

const original = (google: FakeDrive) => structuredClone(google.files.get(ID));
const tab = (google: FakeDrive, title: string, id = ID) => google.files.get(id)?.tabs.find((t) => t.title === title);
const backups = (google: FakeDrive) => [...google.files.entries()].filter(([id]) => id !== ID);
const writes = (google: FakeDrive) => google.requests.filter((r) => r.method !== 'GET' && !r.url.includes('/copy'));

describe('the real migration list', () => {
  it('is complete and in order, ending at the app version', () => {
    expect(MIGRATIONS.map((m) => m.toVersion)).toEqual(Array.from({ length: APP_SCHEMA_VERSION - 1 }, (_, i) => i + 2));
    expect(() => pendingMigrations(MIGRATIONS, 1, APP_SCHEMA_VERSION)).not.toThrow();
  });

  it('never adds the same tab twice, and every tab has the data-safety columns', () => {
    const steps = MIGRATIONS.flatMap((m) => m.steps).flatMap((s) => (s.kind === 'add-tab' ? [s] : []));
    const tabs = steps.map((s) => s.tab);
    expect(new Set(tabs).size).toBe(tabs.length);
    expect(tabs).not.toContain(META_TAB);
    for (const step of steps) {
      expect(step.headers[0]).toBe('id');
      expect(step.headers).toEqual(expect.arrayContaining(['created_at', 'updated_at', 'created_by', 'deleted_at']));
      expect(new Set(step.headers).size).toBe(step.headers.length);
      for (const header of step.headers) expect(header).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it('version 2 adds the Lots tab with the columns agreed on 2026-11-15', () => {
    expect(MIGRATIONS[0]?.steps).toEqual([
      {
        kind: 'add-tab',
        tab: 'Lots',
        headers: [
          'id', 'code', 'name', 'country', 'region', 'altitude', 'process', 'variety', 'supplier', 'delivery_date',
          'quantity_kg', 'coffee_price_net_pln', 'delivery_cost_net_pln', 'notes', 'roastime_container_id',
          'roastime_bean_id', 'roastime_supplier_code', 'created_at', 'updated_at', 'created_by', 'deleted_at',
        ],
      },
    ]);
  });
});

describe('initialTabs', () => {
  it('is _meta at the app version plus every tab the migrations add, in order', () => {
    expect(initialTabs(created, [addA, addB], 3)).toEqual([
      { title: META_TAB, rows: initialMetaRows(created, 3) },
      { title: 'A', rows: [['id', 'name']], frozenRows: 1 },
      { title: 'B', rows: [['id', 'kg']], frozenRows: 1 },
    ]);
  });
});

describe('version 3', () => {
  it('adds the Roasts tab with the columns agreed on 2026-11-15', () => {
    expect(MIGRATIONS[1]?.steps).toEqual([
      {
        kind: 'add-tab',
        tab: 'Roasts',
        headers: [
          'id', 'roasted_at', 'roast_name', 'green_g', 'roasted_g', 'lot_id', 'sample', 'notes', 'roastime_roast_id',
          'roastime_bean_id', 'created_at', 'updated_at', 'created_by', 'deleted_at',
        ],
      },
    ]);
  });
});

describe('version 4', () => {
  it('adds the tabs for Costs & prices, agreed on 2026-11-16', () => {
    const safety = ['created_at', 'updated_at', 'created_by', 'deleted_at'];
    expect(MIGRATIONS[2]?.steps).toEqual([
      { kind: 'add-tab', tab: 'Cost settings', headers: ['id', 'name', 'value', ...safety] },
      { kind: 'add-tab', tab: 'Bag costs', headers: ['id', 'bag_size_id', 'item', 'cost_net_pln', ...safety] },
      { kind: 'add-tab', tab: 'Lot costs', headers: ['id', 'lot_id', 'roast_loss_percent', ...safety] },
    ]);
  });

  it('updates a version 3 sheet with the three tabs, keeping the data', async () => {
    const google = sheetAt(3, [{ title: 'Lots', sheetId: 3, rows: [['id', 'code'], ['L1', 'KENYA-26-09']] }]);
    const result = await migrateSpreadsheet(googleSheetOps(google), ID, { backup: true, now, migrations: MIGRATIONS.slice(0, 3), appVersion: 4 });
    expect(result.toVersion).toBe(4);
    expect(google.files.get(ID)?.tabs.map((t) => t.title)).toEqual([META_TAB, 'Owner notes', 'Lots', 'Cost settings', 'Bag costs', 'Lot costs']);
    expect(tab(google, 'Lots')?.rows).toEqual([['id', 'code'], ['L1', 'KENYA-26-09']]);
    expect(tab(google, META_TAB)?.rows[2]).toEqual(['schema_version', '4']);
  });
});

describe('version 5', () => {
  it('adds the Price list tab, agreed on 2026-11-16', () => {
    const safety = ['created_at', 'updated_at', 'created_by', 'deleted_at'];
    expect(MIGRATIONS[3]?.steps).toEqual([
      { kind: 'add-tab', tab: 'Price list', headers: ['id', 'country', 'coffee_name', 'bag_size_g', 'price_gross_pln', 'valid_from', ...safety] },
    ]);
  });

  it('updates a version 4 sheet with the Price list tab, keeping the data', async () => {
    const google = sheetAt(4, [{ title: 'Cost settings', sheetId: 3, rows: [['id', 'name', 'value'], ['S1', 'vat_percent', '23']] }]);
    const result = await migrateSpreadsheet(googleSheetOps(google), ID, { backup: true, now, migrations: MIGRATIONS.slice(0, 4), appVersion: 5 });
    expect(result.toVersion).toBe(5);
    expect(google.files.get(ID)?.tabs.map((t) => t.title)).toEqual([META_TAB, 'Owner notes', 'Cost settings', 'Price list']);
    expect(tab(google, 'Cost settings')?.rows).toEqual([['id', 'name', 'value'], ['S1', 'vat_percent', '23']]);
    expect(tab(google, META_TAB)?.rows[2]).toEqual(['schema_version', '5']);
  });
});

describe('version 6', () => {
  it('adds the Products tab, agreed on 2026-11-17', () => {
    const safety = ['created_at', 'updated_at', 'created_by', 'deleted_at'];
    const prices = ['price_250_gross_pln', 'price_500_gross_pln', 'price_1000_gross_pln'];
    const details = ['country', 'region', 'altitude', 'processing', 'variety', 'flavour_profile', 'brew_method'];
    expect(MIGRATIONS[4]?.steps).toEqual([{ kind: 'add-tab', tab: 'Products', headers: ['id', 'name', ...details, ...prices, ...safety] }]);
  });

  it('updates a version 5 sheet with the Products tab, keeping the data', async () => {
    const google = sheetAt(5, [{ title: 'Price list', sheetId: 3, rows: [['id', 'country'], ['P1', 'Kenya']] }]);
    const result = await migrateSpreadsheet(googleSheetOps(google), ID, { backup: true, now, migrations: MIGRATIONS.slice(0, 5), appVersion: 6 });
    expect(result.toVersion).toBe(6);
    expect(google.files.get(ID)?.tabs.map((t) => t.title)).toEqual([META_TAB, 'Owner notes', 'Price list', 'Products']);
    expect(tab(google, 'Price list')?.rows).toEqual([['id', 'country'], ['P1', 'Kenya']]);
    expect(tab(google, META_TAB)?.rows[2]).toEqual(['schema_version', '6']);
  });
});

describe('version 7', () => {
  it('adds the Discounts tab, agreed on 2026-11-18', () => {
    const safety = ['created_at', 'updated_at', 'created_by', 'deleted_at'];
    expect(MIGRATIONS[5]?.steps).toEqual([{ kind: 'add-tab', tab: 'Discounts', headers: ['id', 'percent', 'name', ...safety] }]);
  });

  it('updates a version 6 sheet with the Discounts tab, keeping the data', async () => {
    const google = sheetAt(6, [{ title: 'Products', sheetId: 3, rows: [['id', 'name'], ['P1', 'Kenia']] }]);
    const result = await migrateSpreadsheet(googleSheetOps(google), ID, { backup: true, now, migrations: MIGRATIONS.slice(0, 6), appVersion: 7 });
    expect(result.toVersion).toBe(7);
    expect(google.files.get(ID)?.tabs.map((t) => t.title)).toEqual([META_TAB, 'Owner notes', 'Products', 'Discounts']);
    expect(tab(google, 'Products')?.rows).toEqual([['id', 'name'], ['P1', 'Kenia']]);
    expect(tab(google, META_TAB)?.rows[2]).toEqual(['schema_version', '7']);
  });
});

describe('version 8', () => {
  it('adds the Product beans tab, agreed on 2026-11-18', () => {
    const safety = ['created_at', 'updated_at', 'created_by', 'deleted_at'];
    const columns = ['id', 'product_id', 'position', 'lot_id', 'planned_name', 'planned_price_per_kg_pln', 'planned_roast_loss_percent', 'share_percent'];
    expect(MIGRATIONS[6]?.steps).toEqual([{ kind: 'add-tab', tab: 'Product beans', headers: [...columns, ...safety] }]);
  });

  it('updates a version 7 sheet with the Product beans tab, keeping the data', async () => {
    const google = sheetAt(7, [{ title: 'Discounts', sheetId: 3, rows: [['id', 'percent'], ['D1', '15']] }]);
    const result = await migrateSpreadsheet(googleSheetOps(google), ID, { backup: true, now, migrations: MIGRATIONS.slice(0, 7), appVersion: 8 });
    expect(result.toVersion).toBe(8);
    expect(google.files.get(ID)?.tabs.map((t) => t.title)).toEqual([META_TAB, 'Owner notes', 'Discounts', 'Product beans']);
    expect(tab(google, 'Discounts')?.rows).toEqual([['id', 'percent'], ['D1', '15']]);
    expect(tab(google, META_TAB)?.rows[2]).toEqual(['schema_version', '8']);
  });
});

describe('version 9', () => {
  it('adds the Clients tab, agreed on 2026-11-19', () => {
    const safety = ['created_at', 'updated_at', 'created_by', 'deleted_at'];
    expect(MIGRATIONS[7]?.steps).toEqual([{ kind: 'add-tab', tab: 'Clients', headers: ['id', 'name', 'nip', 'email', 'registered_name', 'discount_percent', ...safety] }]);
  });

  it('updates a version 8 sheet with the Clients tab, keeping the data', async () => {
    const google = sheetAt(8, [{ title: 'Product beans', sheetId: 3, rows: [['id', 'product_id'], ['B1', 'P1']] }]);
    const result = await migrateSpreadsheet(googleSheetOps(google), ID, { backup: true, now, migrations: MIGRATIONS.slice(0, 8), appVersion: 9 });
    expect(result.toVersion).toBe(9);
    expect(google.files.get(ID)?.tabs.map((t) => t.title)).toEqual([META_TAB, 'Owner notes', 'Product beans', 'Clients']);
    expect(tab(google, 'Product beans')?.rows).toEqual([['id', 'product_id'], ['B1', 'P1']]);
    expect(tab(google, META_TAB)?.rows[2]).toEqual(['schema_version', '9']);
  });
});

describe('version 10', () => {
  it('adds the Sales and Sale lines tabs, agreed on 2026-11-19', () => {
    const safety = ['created_at', 'updated_at', 'created_by', 'deleted_at'];
    expect(MIGRATIONS[8]?.steps).toEqual([
      { kind: 'add-tab', tab: 'Sales', headers: ['id', 'date', 'kind', 'client_id', 'place', 'reason', 'invoice_status', 'invoice_number', 'invoice_date', 'paid_date', 'notes', ...safety] },
      { kind: 'add-tab', tab: 'Sale lines', headers: ['id', 'sale_id', 'position', 'product_id', 'bag_size_g', 'bags', 'unit_price_net_pln', 'free', ...safety] },
    ]);
  });

  it('updates a version 9 sheet with the two tabs, keeping the data', async () => {
    const google = sheetAt(9, [{ title: 'Clients', sheetId: 3, rows: [['id', 'name'], ['C1', 'Café Nowa']] }]);
    const result = await migrateSpreadsheet(googleSheetOps(google), ID, { backup: true, now, migrations: MIGRATIONS.slice(0, 9), appVersion: 10 });
    expect(result.toVersion).toBe(10);
    expect(google.files.get(ID)?.tabs.map((t) => t.title)).toEqual([META_TAB, 'Owner notes', 'Clients', 'Sales', 'Sale lines']);
    expect(tab(google, 'Clients')?.rows).toEqual([['id', 'name'], ['C1', 'Café Nowa']]);
    expect(tab(google, META_TAB)?.rows[2]).toEqual(['schema_version', '10']);
  });
});

describe('version 11', () => {
  const productsHeader = ['id', 'name', 'country', 'region', 'altitude', 'processing', 'variety', 'flavour_profile', 'brew_method', 'price_250_gross_pln', 'price_500_gross_pln', 'price_1000_gross_pln', 'created_at', 'updated_at', 'created_by', 'deleted_at'];
  const product = ['P1', 'GWATEMALA', 'Gwatemala', '', '', '', '', '', '', '59', '', '', '2026-11-17T10:00:00.000Z', '2026-11-17T10:00:00.000Z', 'owner@example.com', ''];

  it('adds the position column to the Products tab, agreed on 2026-11-19', () => {
    expect(MIGRATIONS[9]?.steps).toEqual([{ kind: 'add-columns', tab: 'Products', columns: ['position'] }]);
    expect(initialTabs(created).find((t) => t.title === 'Products')?.rows[0]).toEqual([...productsHeader, 'position']);
  });

  it('writes only the new header cell after the last column; every product row stays as it was', async () => {
    const google = sheetAt(10, [{ title: 'Products', sheetId: 3, rows: [[...productsHeader], [...product]] }]);
    const result = await migrateSpreadsheet(googleSheetOps(google), ID, { backup: true, now, migrations: MIGRATIONS, appVersion: 11 });
    expect(result).toMatchObject({ fromVersion: 10, toVersion: 11 });
    expect(tab(google, 'Products')?.rows).toEqual([[...productsHeader, 'position'], product]);
    expect(writes(google).filter((r) => r.url.includes('Products'))).toHaveLength(1); // only the header cell Q1
    expect(writes(google).some((r) => decodeURIComponent(r.url).includes("'Products'!Q1:Q1"))).toBe(true);
    expect(tab(google, META_TAB)?.rows[2]).toEqual(['schema_version', '11']);
  });

  it('never overwrites a column added by hand, and skips a column already there (safe to run again)', async () => {
    const byHand = [...productsHeader, 'my notes'];
    const google = sheetAt(10, [{ title: 'Products', sheetId: 3, rows: [[...byHand], [...product, 'roast lighter']] }]);
    await migrateSpreadsheet(googleSheetOps(google), ID, { backup: true, now, migrations: MIGRATIONS, appVersion: 11 });
    expect(tab(google, 'Products')?.rows).toEqual([[...byHand, 'position'], [...product, 'roast lighter']]);

    const again = sheetAt(10, [{ title: 'Products', sheetId: 3, rows: [[...productsHeader, 'position'], [...product]] }]);
    await migrateSpreadsheet(googleSheetOps(again), ID, { backup: true, now, migrations: MIGRATIONS, appVersion: 11 });
    expect(tab(again, 'Products')?.rows).toEqual([[...productsHeader, 'position'], product]);
    expect(writes(again).filter((r) => r.url.includes('Products'))).toHaveLength(0);
  });

  it('stops without raising the version when the Products tab is missing', async () => {
    const google = sheetAt(10);
    await expect(migrateSpreadsheet(googleSheetOps(google), ID, { backup: true, now, migrations: MIGRATIONS, appVersion: 11 })).rejects.toThrow('has no "Products" tab');
    expect(tab(google, META_TAB)?.rows[2]).toEqual(['schema_version', '10']);
  });
});

describe('helpers', () => {
  it('names the backup with the local date and the next version', () => {
    expect(backupName(now, 2)).toBe('Kraken backup 2026-11-15 (before v2)');
    expect(backupName(new Date(2027, 0, 5), 10)).toBe('Kraken backup 2027-01-05 (before v10)');
  });

  it('counts only rows with something in them', () => {
    expect(countRows([['a'], [], ['', ' '], [null, 'x'], [undefined]])).toBe(2);
  });

  it('plans the missing migrations in order and refuses gaps', () => {
    expect(pendingMigrations([addB, addA], 1, 3)).toEqual([addA, addB]);
    expect(pendingMigrations([addA, addB], 2, 3)).toEqual([addB]);
    expect(pendingMigrations([addA, addB], 3, 3)).toEqual([]);
    expect(() => pendingMigrations([addB], 1, 3)).toThrow('version 2 is missing');
    expect(() => pendingMigrations([addA], 1, 3)).toThrow('up to version 3 are missing');
  });

  it('describes the update for the screen', () => {
    expect(updatePlan(1, now, [addA, addB], 3)).toEqual({
      toVersion: 3,
      changes: ['Data version 2: adds A', 'Data version 3: adds B'],
      backupName: 'Kraken backup 2026-11-15 (before v2)',
    });
  });
});

describe('migrateSpreadsheet', () => {
  it('backs up, adds the tabs, keeps every existing row and raises the version', async () => {
    const google = sheetAt(1);
    const before = original(google);
    const progress: string[] = [];

    const result = await run(google, { onProgress: (text) => progress.push(text) });

    expect(result).toEqual({ fromVersion: 1, toVersion: 3, backupName: 'Kraken backup 2026-11-15 (before v2)' });
    // The backup is a full, identical copy of the sheet as it was.
    const [[, backup] = []] = backups(google);
    expect(backup).toEqual({ ...before, name: 'Kraken backup 2026-11-15 (before v2)' });
    // New tabs with their headers.
    expect(tab(google, 'A')?.rows).toEqual([['id', 'name']]);
    expect(tab(google, 'B')?.rows).toEqual([['id', 'kg']]);
    // Old tabs untouched, except the version number.
    expect(tab(google, 'Owner notes')).toEqual(before?.tabs[1]);
    expect(tab(google, META_TAB)?.rows).toEqual([...metaRows(3), ['note', 'keep me']]);
    expect(progress).toEqual([
      'Making a backup copy "Kraken backup 2026-11-15 (before v2)"…',
      'Checking the backup copy…',
      'Updating to data version 2: adds A…',
      'Updating to data version 3: adds B…',
      'Update finished.',
    ]);
  });

  it('runs only the migrations the sheet is missing', async () => {
    const google = sheetAt(2, [{ title: 'A', sheetId: 3, rows: [['id', 'name'], ['a1', 'kept']] }]);
    const result = await run(google);
    expect(result.fromVersion).toBe(2);
    expect(tab(google, 'A')?.rows).toEqual([['id', 'name'], ['a1', 'kept']]);
    expect(tab(google, 'B')?.rows).toEqual([['id', 'kg']]);
    expect(tab(google, META_TAB)?.rows[2]).toEqual(['schema_version', '3']);
  });

  it('does nothing at all when the sheet is already up to date', async () => {
    const google = sheetAt(3);
    expect(await run(google)).toEqual({ fromVersion: 3, toVersion: 3, backupName: null });
    expect(writes(google)).toEqual([]);
    expect(backups(google)).toEqual([]);
  });

  it('works without a backup for a brand-new sheet', async () => {
    const google = sheetAt(1);
    expect((await run(google, { backup: false })).backupName).toBeNull();
    expect(backups(google)).toEqual([]);
    expect(tab(google, META_TAB)?.rows[2]).toEqual(['schema_version', '3']);
  });

  it.each([
    ['a sheet written by a newer Kraken', 4],
    ['a sheet with a broken version', 0],
  ])('refuses %s and changes nothing', async (_name, v) => {
    const google = sheetAt(v);
    const before = original(google);
    await expect(run(google)).rejects.toBeInstanceOf(MigrationError);
    expect(google.files.get(ID)).toEqual(before);
    expect(writes(google)).toEqual([]);
    expect(backups(google)).toEqual([]);
  });

  it('refuses a sheet without _meta and changes nothing', async () => {
    const google = fakeGoogleDrive();
    google.addFile(ID, { name: 'Budget', tabs: [{ title: 'Sheet1', sheetId: 0, rows: [['x']] }] });
    await expect(run(google)).rejects.toThrow('not a Kraken sheet');
    expect(writes(google)).toEqual([]);
  });

  describe('when something goes wrong', () => {
    it('stops before any change if the backup copy cannot be made', async () => {
      const google = sheetAt(1);
      const before = original(google);
      google.failWhen.push((r) => (r.url.includes('/copy') ? 500 : undefined));
      await expect(run(google)).rejects.toBeInstanceOf(SheetsError);
      expect(google.files.get(ID)).toEqual(before);
      expect(writes(google)).toEqual([]);
    });

    it('stops before any change if the backup copy is not identical', async () => {
      const google = sheetAt(1);
      const before = original(google);
      google.afterCopy = (copy) => copy.tabs[1]?.rows.pop();
      const error = await run(google).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(MigrationError);
      expect((error as MigrationError).message).toContain('Nothing in your sheet was changed');
      expect(google.files.get(ID)).toEqual(before);
      expect(writes(google)).toEqual([]);
    });

    it('accepts a backup whose formulas show different values (e.g. =TODAY())', async () => {
      const google = sheetAt(1);
      google.afterCopy = (copy) => {
        const notes = copy.tabs[1];
        if (notes) notes.rows[1] = ['roast Kenya', '2026-11-16'];
      };
      await run(google);
      expect(tab(google, META_TAB)?.rows[2]).toEqual(['schema_version', '3']);
    });

    it('stops before any change if the backup copy has different headers', async () => {
      const google = sheetAt(1);
      const before = original(google);
      google.afterCopy = (copy) => {
        const notes = copy.tabs[1];
        if (notes) notes.rows[0] = ['what', 'WHEN'];
      };
      await expect(run(google)).rejects.toThrow('does not match');
      expect(google.files.get(ID)).toEqual(before);
    });

    it('keeps the old version if adding a tab fails, and a second try finishes the job', async () => {
      const google = sheetAt(1);
      const failing = (r: { url: string }) => (r.url.includes(':batchUpdate') ? 500 : undefined);
      google.failWhen.push(failing);
      await expect(run(google)).rejects.toBeInstanceOf(SheetsError);
      expect(tab(google, META_TAB)?.rows[2]).toEqual(['schema_version', '1']);
      expect(tab(google, 'A')).toBeUndefined();

      google.failWhen.length = 0;
      await run(google);
      expect(tab(google, META_TAB)?.rows[2]).toEqual(['schema_version', '3']);
      expect(backups(google)).toHaveLength(2); // a fresh backup for each try
    });

    it('finishes after a failure between adding the tab and raising the version', async () => {
      const google = sheetAt(1);
      google.failWhen.push((r) => (r.method === 'PUT' ? 503 : undefined));
      await expect(run(google)).rejects.toBeInstanceOf(SheetsError);
      expect(tab(google, 'A')?.rows).toEqual([['id', 'name']]); // the tab got added
      expect(tab(google, META_TAB)?.rows[2]).toEqual(['schema_version', '1']); // but the version was not raised

      google.failWhen.length = 0;
      await run(google);
      expect(tab(google, 'A')?.rows).toEqual([['id', 'name']]); // recognised, not added twice
      expect(tab(google, META_TAB)?.rows[2]).toEqual(['schema_version', '3']);
    });

    it.each([
      ['different headers', [['code', 'name']]],
      ['rows of data', [['id', 'name'], ['x1', 'typed by hand']]],
    ])('never touches a tab of the same name that Kraken did not make (%s)', async (_name, rows) => {
      const google = sheetAt(1, [{ title: 'A', sheetId: 3, rows }]);
      const error = await run(google).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(MigrationError);
      expect((error as MigrationError).message).toContain('already has a "A" tab');
      expect((error as MigrationError).backupName).toBe('Kraken backup 2026-11-15 (before v2)');
      expect(tab(google, 'A')?.rows).toEqual(rows);
      expect(tab(google, META_TAB)?.rows[2]).toEqual(['schema_version', '1']);
    });

    it('stops before any backup or change when _meta has two schema_version rows', async () => {
      const google = sheetAt(1);
      tab(google, META_TAB)?.rows.push(['schema_version', '1']);
      await expect(run(google)).rejects.toThrow('no single schema_version row');
      expect(writes(google)).toEqual([]);
      expect(backups(google)).toEqual([]);
    });

    it('ignores a stray schema_version row without a value', async () => {
      const google = sheetAt(1);
      tab(google, META_TAB)?.rows.push(['schema_version']);
      await run(google);
      expect(tab(google, META_TAB)?.rows[2]).toEqual(['schema_version', '3']);
    });

    it('stops if the other person moved the sheet to a newer version meanwhile', async () => {
      const google = sheetAt(1);
      google.failWhen.push((r) => {
        if (r.url.includes(':batchUpdate')) {
          const meta = tab(google, META_TAB);
          if (meta) meta.rows[2] = ['schema_version', '5'];
        }
        return undefined;
      });
      await expect(run(google)).rejects.toThrow('changed while updating');
      expect(tab(google, META_TAB)?.rows[2]).toEqual(['schema_version', '5']);
    });

    it('finishes without error if the other person completed the whole update meanwhile', async () => {
      const google = sheetAt(1);
      google.failWhen.push((r) => {
        const meta = tab(google, META_TAB);
        if (r.url.includes(':batchUpdate') && meta) meta.rows[2] = ['schema_version', '3'];
        return undefined;
      });
      expect((await run(google)).toVersion).toBe(3);
      expect(writes(google).filter((r) => r.method === 'PUT')).toEqual([]);
    });

    it('carries on if the other person already finished the same step', async () => {
      const google = sheetAt(1);
      google.failWhen.push((r) => {
        const meta = tab(google, META_TAB);
        if (r.url.includes(':batchUpdate') && meta?.rows[2]?.[1] === '1') meta.rows[2] = ['schema_version', '2'];
        return undefined;
      });
      await run(google);
      expect(tab(google, META_TAB)?.rows[2]).toEqual(['schema_version', '3']);
    });
  });
});
