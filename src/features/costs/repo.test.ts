import { describe, expect, it } from 'vitest';
import { createKrakenSpreadsheet } from '../../schema';
import { fakeGoogleDrive } from '../../testing/fakeGoogleDrive';
import { DEFAULT_SETTINGS, readSettings } from './model';
import { sheetCostsRepository } from './repo';

const now = new Date('2026-11-16T10:00:00.000Z');
const later = new Date('2026-11-16T11:00:00.000Z');
const who = async () => 'owner@example.com';
/** For edits of existing rows: asking who is signed in would be a wasted Google request. */
const notAsked = async (): Promise<string> => {
  throw new Error('who is signed in should not be asked for an edit');
};

async function setup() {
  const google = fakeGoogleDrive();
  const info = await createKrakenSpreadsheet(google, now);
  return { google, repo: sheetCostsRepository(google, info.id) };
}

describe('sheetCostsRepository (in-memory Google)', () => {
  it('starts empty on a new sheet', async () => {
    const { repo } = await setup();
    expect(await repo.load()).toEqual({ settings: [], costs: [], lotCosts: [], problems: [] });
  });

  it('saves settings: adds new ones, then changes only what changed', async () => {
    const { google, repo } = await setup();
    await repo.saveSettings({ vat_percent: '23', markups: '2;2.5;3', default_roast_loss_percent: '15' }, [], who, now);
    let data = await repo.load();
    expect(readSettings(data.settings).settings).toEqual(DEFAULT_SETTINGS);
    google.requests.length = 0;
    await repo.saveSettings({ vat_percent: '8', markups: '2;2.5;3', default_roast_loss_percent: '15' }, data.settings, notAsked, later);
    expect(google.requests.filter((r) => r.method !== 'GET' && !r.url.includes(':batchGet'))).toHaveLength(1);
    data = await repo.load();
    expect(data.settings).toHaveLength(3);
    expect(readSettings(data.settings).settings.vatTenths).toBe(80);
  });

  it('adds cost items to a bag size, edits and soft-deletes them', async () => {
    const { repo } = await setup();
    await repo.addBagCost({ bag_size_id: '250', item: 'Bag', cost_net_pln: '1.2' }, 'owner@example.com', now);
    let data = await repo.load();
    const [bag] = data.costs;
    if (!bag) throw new Error('setup');
    await repo.updateBagCost(bag, { item: 'Bag', cost_net_pln: '1.25' }, later);
    data = await repo.load();
    expect(data.costs.map((c) => [c.item, c.costGrosze, c.bagSizeId])).toEqual([['Bag', 125, '250']]);
    const [changed] = data.costs;
    if (!changed) throw new Error('setup');
    await repo.removeBagCost(changed, later);
    expect((await repo.load()).costs[0]?.deletedAt).toBe(later.toISOString());
  });

  it("saves a lot's own roast loss, changes it, and clears it back to the average", async () => {
    const { repo } = await setup();
    await repo.saveLoss('L1', '', undefined, notAsked, now); // nothing to clear: nothing written
    expect((await repo.load()).lotCosts).toEqual([]);
    await repo.saveLoss('L1', '14.2', undefined, who, now);
    let [own] = (await repo.load()).lotCosts;
    expect(own).toMatchObject({ lotId: 'L1', lossTenths: 142 });
    await repo.saveLoss('L1', '', own, notAsked, later);
    [own] = (await repo.load()).lotCosts;
    expect(own).toMatchObject({ lotId: 'L1', lossTenths: null, lossText: '' });
  });
});
