import { describe, expect, it } from 'vitest';
import { createKrakenSpreadsheet } from '../../schema';
import { fakeGoogleDrive } from '../../testing/fakeGoogleDrive';
import { sheetProductsRepository } from './repo';

const now = new Date('2026-11-17T10:00:00.000Z');
const later = new Date('2026-11-17T11:00:00.000Z');

describe('sheetProductsRepository (in-memory Google)', () => {
  it('adds, edits, soft-deletes and restores a product', async () => {
    const google = fakeGoogleDrive();
    const info = await createKrakenSpreadsheet(google, now);
    const repo = sheetProductsRepository(google, info.id);
    expect(await repo.load()).toEqual({ products: [], problems: [] });

    const id = await repo.add({ name: 'Kenia', brew_method: 'Filtr', price_250_gross_pln: '59' }, 'owner@example.com', now);
    let [kenia] = (await repo.load()).products;
    if (!kenia) throw new Error('setup');
    expect(kenia.id).toBe(id);
    expect(kenia).toMatchObject({ name: 'Kenia', brewMethod: 'Filtr', prices: { 250: 5900 } });

    await repo.update(kenia, { price_250_gross_pln: '61' }, later);
    [kenia] = (await repo.load()).products;
    if (!kenia) throw new Error('setup');
    expect(kenia.prices).toEqual({ 250: 6100 });

    await repo.remove(kenia, later);
    [kenia] = (await repo.load()).products;
    if (!kenia) throw new Error('setup');
    expect(kenia.deletedAt).toBe(later.toISOString());

    await repo.restore(kenia, later);
    expect((await repo.load()).products[0]?.deletedAt).toBe('');
  });
});
