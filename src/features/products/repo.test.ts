import { describe, expect, it } from 'vitest';
import { createKrakenSpreadsheet } from '../../schema';
import { fakeGoogleDrive } from '../../testing/fakeGoogleDrive';
import { movedOrder, positionChanges, sortProducts, type Product } from './model';
import { beansOf } from './modelBeans';
import { sheetProductsRepository } from './repo';

const now = new Date('2026-11-17T10:00:00.000Z');
const later = new Date('2026-11-17T11:00:00.000Z');

describe('sheetProductsRepository (in-memory Google)', () => {
  it('adds, edits, soft-deletes and restores a product', async () => {
    const google = fakeGoogleDrive();
    const info = await createKrakenSpreadsheet(google, now);
    const repo = sheetProductsRepository(google, info.id);
    expect(await repo.load()).toEqual({ products: [], beans: [], problems: [] });

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

  it("saves a product's beans: adds, changes and soft-deletes them", async () => {
    const google = fakeGoogleDrive();
    const info = await createKrakenSpreadsheet(google, now);
    const repo = sheetProductsRepository(google, info.id);
    const lotBean = (position: string, lotId: string, share: string) => ({ position, share_percent: share, lot_id: lotId, planned_name: '', planned_price_per_kg_pln: '', planned_roast_loss_percent: '' });
    const who = async () => 'owner@example.com';
    await repo.saveBeans('P1', [lotBean('1', 'L1', '60'), lotBean('2', 'L2', '40')], [], who, now);
    let beans = beansOf((await repo.load()).beans, 'P1');
    expect(beans.map((b) => [b.position, b.lotId, b.sharePercent])).toEqual([
      [1, 'L1', 60],
      [2, 'L2', 40],
    ]);
    const notAsked = async (): Promise<string> => {
      throw new Error('who is signed in should not be asked when nothing is added');
    };
    await repo.saveBeans('P1', [lotBean('1', 'L1', '100')], beans, notAsked, later);
    const all = (await repo.load()).beans;
    beans = beansOf(all, 'P1');
    expect(beans.map((b) => [b.position, b.lotId, b.sharePercent])).toEqual([[1, 'L1', 100]]);
    expect(all.filter((b) => b.deletedAt !== '').map((b) => b.lotId)).toEqual(['L2']); // kept, soft-deleted
  });

  it('saves the order: the first move numbers every product, later moves write only what changed', async () => {
    const google = fakeGoogleDrive();
    const info = await createKrakenSpreadsheet(google, now);
    const repo = sheetProductsRepository(google, info.id);
    for (const name of ['Burundi', 'Kenia', 'Peru']) await repo.add({ name }, 'owner@example.com', now);
    const active = async () => sortProducts((await repo.load()).products);
    const names = async () => (await active()).map((p) => [p.name, p.position]);
    const ids = (list: readonly Product[]) => list.map((p) => p.id);
    expect(await names()).toEqual([
      ['Burundi', null],
      ['Kenia', null],
      ['Peru', null],
    ]);

    let list = await active();
    const saved = await repo.savePositions(positionChanges(list, movedOrder(ids(list), list[2]?.id ?? '', 1)), later); // Peru up one
    expect(saved.map((p) => [p.name, p.position, p.source['updated_at']])).toEqual([
      ['Burundi', 1, later.toISOString()],
      ['Peru', 2, later.toISOString()],
      ['Kenia', 3, later.toISOString()],
    ]);
    expect(await names()).toEqual([
      ['Burundi', 1],
      ['Peru', 2],
      ['Kenia', 3],
    ]);
    // The saved copies are the stored ones: the next move, built on them, is not refused as "changed meanwhile".
    const second = positionChanges(saved, ['P', 'B', 'K'].map((l) => saved.find((p) => p.name.startsWith(l))?.id ?? ''));
    expect(second.map((c) => [c.product.name, c.position])).toEqual([
      ['Peru', 1],
      ['Burundi', 2],
    ]);
    await repo.savePositions(second, later);
    expect(await names()).toEqual([
      ['Peru', 1],
      ['Burundi', 2],
      ['Kenia', 3],
    ]);

    // a new product goes to the end
    await repo.add({ name: 'Etiopia' }, 'owner@example.com', later);
    list = await active();
    expect(list.map((p) => p.name)).toEqual(['Peru', 'Burundi', 'Kenia', 'Etiopia']);
  });
});
