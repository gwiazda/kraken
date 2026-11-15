// The Lots repository against an in-memory Google, on a sheet created exactly like a real Kraken sheet.

import { describe, expect, it } from 'vitest';
import { ConflictError } from '../../core/records';
import { createKrakenSpreadsheet } from '../../schema';
import { fakeGoogleDrive } from '../../testing/fakeGoogleDrive';
import { validateLotForm, type LotForm } from './model';
import { sheetLotsRepository } from './repo';

const t1 = new Date('2026-11-15T10:00:00.000Z');
const t2 = new Date('2026-11-15T11:00:00.000Z');
const t3 = new Date('2026-11-15T12:00:00.000Z');

const form: LotForm = {
  code: 'KENYA-26-11',
  name: 'Kenya Kegwa',
  country: 'Kenya',
  region: '',
  altitude: '',
  process: 'Washed',
  variety: '',
  supplier: '',
  deliveryDate: '2026-11-03',
  quantityKg: '60',
  coffeePrice: '',
  deliveryCost: '',
  notes: '',
};

function fieldsOf(f: LotForm) {
  const result = validateLotForm(f, []);
  if (!result.ok) throw new Error('test form is invalid');
  return result.fields;
}

async function setup() {
  const google = fakeGoogleDrive();
  const info = await createKrakenSpreadsheet(google, t1);
  return { google, repo: sheetLotsRepository(google, info.id), lotsRows: () => google.files.get(info.id)?.tabs.find((t) => t.title === 'Lots')?.rows };
}

describe('sheetLotsRepository', () => {
  it('starts empty on a new Kraken sheet', async () => {
    const { repo } = await setup();
    expect(await repo.load()).toEqual({ lots: [], problems: [] });
  });

  it('adds a lot and reads it back the same', async () => {
    const { repo } = await setup();
    const added = await repo.add(fieldsOf(form), 'owner@example.com', t1);
    expect(added).toMatchObject({ code: 'KENYA-26-11', quantityGrams: 60000, coffeePriceGrosze: null, createdBy: 'owner@example.com', deletedAt: '' });
    expect(added.id).not.toBe('');

    const { lots } = await repo.load();
    expect(lots.map((l) => ({ ...l, source: {} }))).toEqual([{ ...added, row: 2, source: {} }]);
  });

  it('enters the price later, keeping everything else', async () => {
    const { repo } = await setup();
    const added = await repo.add(fieldsOf(form), 'me', t1);
    const priced = await repo.update(added, fieldsOf({ ...form, coffeePrice: '4500', deliveryCost: '120,50' }), t2);
    expect(priced).toMatchObject({ coffeePriceGrosze: 450000, deliveryCostGrosze: 12050, createdAt: added.createdAt, createdBy: 'me' });
    expect({ ...(await repo.load()).lots[0], source: {} }).toEqual({ ...priced, row: 2, source: {} });
  });

  it('soft-deletes and restores: the row stays in the sheet', async () => {
    const { repo, lotsRows } = await setup();
    const added = await repo.add(fieldsOf(form), 'me', t1);
    const deleted = await repo.remove(added, t2);
    expect(deleted.deletedAt).toBe(t2.toISOString());
    expect(lotsRows()).toHaveLength(2);
    expect((await repo.load()).lots).toHaveLength(1);

    const restored = await repo.restore(deleted, t3);
    expect(restored.deletedAt).toBe('');
  });

  it('keeps a quantity the partner corrected directly in the sheet while the form was open', async () => {
    const { repo, lotsRows } = await setup();
    const added = await repo.add(fieldsOf(form), 'me', t1);
    const header = lotsRows()?.[0] ?? [];
    const row = lotsRows()?.[1];
    if (row) row[header.indexOf('quantity_kg')] = '59.5';
    await repo.update(added, fieldsOf({ ...form, notes: 'my note' }), t2);
    expect((await repo.load()).lots[0]).toMatchObject({ quantityGrams: 59500, notes: 'my note' });
  });

  it("refuses to overwrite the partner's newer change", async () => {
    const { repo } = await setup();
    const mine = await repo.add(fieldsOf(form), 'me', t1);
    await repo.update(mine, fieldsOf({ ...form, coffeePrice: '4500' }), t2); // partner, from their screen
    await expect(repo.update(mine, fieldsOf({ ...form, notes: 'my edit' }), t3)).rejects.toBeInstanceOf(ConflictError);
  });

  it('shows a row typed by hand without an ID as a problem, not as a lot', async () => {
    const { repo, lotsRows } = await setup();
    lotsRows()?.push(['', 'TYPED-BY-HAND']);
    expect(await repo.load()).toEqual({ lots: [], problems: ['Row 2 of "Lots" has no ID, so Kraken ignores it. Was it typed in by hand?'] });
  });
});
