import { describe, expect, it } from 'vitest';
import { createKrakenSpreadsheet } from '../../schema';
import { fakeGoogleDrive } from '../../testing/fakeGoogleDrive';
import { dealsOf } from './modelPrices';
import { sheetSpecialPricesRepository } from './repoPrices';

const now = new Date('2026-11-20T10:00:00.000Z');
const later = new Date('2026-11-20T11:00:00.000Z');

describe('sheetSpecialPricesRepository (in-memory Google)', () => {
  it('adds, changes, soft-deletes and restores a deal', async () => {
    const google = fakeGoogleDrive();
    const info = await createKrakenSpreadsheet(google, now);
    const repo = sheetSpecialPricesRepository(google, info.id);
    expect(await repo.load()).toEqual({ deals: [], problems: [] });

    await repo.add({ client_id: 'C1', product_id: 'P1', bag_size_g: '250', price_net_pln: '38', retail_gross_pln_at_deal: '59' }, 'owner@example.com', now);
    let [deal] = (await repo.load()).deals;
    if (!deal) throw new Error('setup');
    expect(deal).toMatchObject({ clientId: 'C1', productId: 'P1', grams: 250, netGrosze: 3800, retailAtDeal: 5900 });

    await repo.update(deal, { price_net_pln: '36.5' }, later);
    [deal] = (await repo.load()).deals;
    if (!deal) throw new Error('setup');
    expect(deal.netGrosze).toBe(3650);

    await repo.remove(deal, later);
    let deals = (await repo.load()).deals;
    expect(dealsOf(deals, 'C1')).toEqual([]);
    [deal] = deals;
    if (!deal) throw new Error('setup');
    await repo.restore(deal, later);
    deals = (await repo.load()).deals;
    expect(dealsOf(deals, 'C1').map((d) => d.netGrosze)).toEqual([3650]);
  });
});
