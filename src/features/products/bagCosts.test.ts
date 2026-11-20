import { describe, expect, it } from 'vitest';
import { createKrakenSpreadsheet } from '../../schema';
import { fakeGoogleDrive } from '../../testing/fakeGoogleDrive';
import { sheetCostsRepository } from '../costs';
import { sheetLotsRepository } from '../lots';
import { sheetRoastsRepository } from '../roasts';
import { loadProductsWithCosts } from './bagCosts';
import { sheetProductsRepository } from './repo';

// Made-up products and costs.
const now = new Date('2026-11-20T10:00:00.000Z');

describe('loadProductsWithCosts (in-memory Google)', () => {
  it('works out what one bag of each product costs, as on the product page; deleted products are left out', async () => {
    const google = fakeGoogleDrive();
    const { id } = await createKrakenSpreadsheet(google, now);
    const products = sheetProductsRepository(google, id);
    const costs = sheetCostsRepository(google, id);
    await costs.addBagCost({ bag_size_id: '250', item: 'Bag', cost_net_pln: '1.5' }, 'owner@example.com', now);
    await products.add({ name: 'KENIA', price_250_gross_pln: '59' }, 'owner@example.com', now);
    await products.add({ name: 'OLD', price_250_gross_pln: '40' }, 'owner@example.com', now);
    const [kenia, old] = (await products.load()).products;
    if (!kenia || !old) throw new Error('setup');
    // A planned bean at 77 zł per kg green, losing the usual 15 % when roasted.
    await products.saveBeans(kenia.id, [{ position: '1', lot_id: '', planned_name: 'Kegwa', planned_price_per_kg_pln: '77', planned_roast_loss_percent: '', share_percent: '100' }], [], async () => 'owner@example.com', now);
    await products.remove(old, now);

    const found = await loadProductsWithCosts({
      products,
      costs,
      lots: sheetLotsRepository(google, id),
      roasts: sheetRoastsRepository(google, id),
      isSignedOut: () => false,
      isIgnorable: () => false,
      describeError: String,
    });
    // 77 zł ÷ 0,85 = 90,588 zł per kg roasted; 250 g = 22,647 zł; with 1,50 zł packaging 24,147 zł.
    expect(Math.round(found.bagCosts.get(kenia.id)?.[250] ?? 0)).toBe(2415);
    expect(found.bagCosts.get(kenia.id)?.[1000]).toBeUndefined(); // no packaging for 1 kg: cannot be worked out
    expect(found.bagCosts.has(old.id)).toBe(false);
    expect(found.products.map((p) => p.name)).toEqual(['KENIA', 'OLD']);
    expect(found.vatTenths).toBe(230);
    expect(found.problems).toEqual([]);
  });
});
