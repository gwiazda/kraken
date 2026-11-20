import { describe, expect, it } from 'vitest';
import { createKrakenSpreadsheet } from '../../schema';
import { fakeGoogleDrive } from '../../testing/fakeGoogleDrive';
import { lotFromFields, sheetLotsRepository } from '../lots';
import { roastFromFields, sheetRoastsRepository } from '../roasts';
import { ImportStopped, applySync, changeCount, summaryOf, type SyncWrites } from './apply';
import type { Operation } from './plan';

const now = new Date('2026-11-15T10:00:00.000Z');
const addLot = (code: string): Operation => ({ kind: 'add', label: `Add ${code}`, fields: { code, name: code, country: 'Kenya', delivery_date: '2026-11-03', quantity_kg: '60' } });
const roastFields = (id: string) => ({ roasted_at: '2026-11-03T08:00:00.000Z', roast_name: id, green_g: '1200', roasted_g: '', roastime_roast_id: id, roastime_bean_id: 'B1', lot_id: '', sample: '', notes: '' });
const none: SyncWrites = { lotOps: [], roastAdds: [], roastUpdates: [], roastRemovals: [], roastRestores: [] };

async function setup() {
  const google = fakeGoogleDrive();
  const info = await createKrakenSpreadsheet(google, now);
  const lots = sheetLotsRepository(google, info.id);
  const roasts = sheetRoastsRepository(google, info.id);
  let asked = 0;
  const deps = {
    lots,
    roasts,
    whoAmI: async () => {
      asked++;
      return 'owner@example.com';
    },
    now: () => now,
    onProgress: (t: string) => progress.push(t),
  };
  const progress: string[] = [];
  return { google, lots, roasts, deps, progress, asked: () => asked };
}

describe('applySync', () => {
  it('saves new lots and many roasts with one request each, as the signed-in person', async () => {
    const { google, lots, roasts, deps, progress } = await setup();
    const roastAdds = Array.from({ length: 150 }, (_, i) => roastFields(`R${i}`));
    const result = await applySync({ lotOps: [addLot('A'), addLot('B')], roastAdds, roastUpdates: [], roastRemovals: [], roastRestores: [] }, deps);
    expect(result).toEqual({ lotsAdded: 2, lotsUpdated: 0, roastsAdded: 150, roastsUpdated: 0, roastsRemoved: 0, roastsRestored: 0 });
    expect(google.requests.filter((r) => r.url.includes(':append'))).toHaveLength(2);
    expect((await lots.load()).lots.map((l) => l.createdBy)).toEqual(['owner@example.com', 'owner@example.com']);
    expect((await roasts.load()).roasts).toHaveLength(150);
    expect(progress).toEqual(['Dodaję 2 nowe dostawy…', 'Dodaję 150 wypałów…']);
  });

  it('updates lots and roasts in one request each', async () => {
    const { google, lots, roasts, deps } = await setup();
    await applySync({ lotOps: [addLot('A')], roastAdds: [roastFields('R1'), roastFields('R2')], roastUpdates: [], roastRemovals: [], roastRestores: [] }, deps);
    const [lot] = (await lots.load()).lots;
    const loadedRoasts = (await roasts.load()).roasts;
    if (!lot) throw new Error('setup');
    google.requests.length = 0;
    const result = await applySync(
      {
        lotOps: [{ kind: 'update', lot, label: 'Update A', fields: { name: 'New' } }],
        roastAdds: [],
        roastUpdates: loadedRoasts.map((roast) => ({ roast, fields: { roasted_g: '1020' } })),
        roastRemovals: [],
        roastRestores: [],
      },
      deps,
    );
    expect(result).toEqual({ lotsAdded: 0, lotsUpdated: 1, roastsAdded: 0, roastsUpdated: 2, roastsRemoved: 0, roastsRestored: 0 });
    expect(google.requests.filter((r) => r.url.endsWith('/values:batchUpdate'))).toHaveLength(2);
    expect((await roasts.load()).roasts.map((r) => r.roastedDecigrams)).toEqual([10200, 10200]);
  });

  it('removes samples and brings roasts back in the same single request as the updates', async () => {
    const { google, roasts, deps } = await setup();
    await applySync({ ...none, roastAdds: [roastFields('R1'), roastFields('R2'), roastFields('R3')] }, deps);
    const [r1, r2, r3] = (await roasts.load()).roasts;
    if (!r1 || !r2 || !r3) throw new Error('setup');
    await roasts.remove(r3, now);
    const deletedR3 = (await roasts.load()).roasts[2];
    if (!deletedR3) throw new Error('setup');
    google.requests.length = 0;
    const result = await applySync(
      { ...none, roastUpdates: [{ roast: r1, fields: { roasted_g: '1020' } }], roastRemovals: [r2], roastRestores: [{ roast: deletedR3, fields: { roastime_bean_id: 'B2' } }] },
      deps,
    );
    expect(result).toMatchObject({ roastsUpdated: 1, roastsRemoved: 1, roastsRestored: 1 });
    expect(google.requests.filter((r) => r.url.endsWith('/values:batchUpdate'))).toHaveLength(1);
    const after = (await roasts.load()).roasts;
    expect(after.map((r) => r.deletedAt !== '')).toEqual([false, true, false]);
    expect(after[1]?.deletedAt).toBe(now.toISOString());
    expect(after[2]?.roastime.beanId).toBe('B2');
  });

  it('does not ask who is signed in when nothing is added', async () => {
    const { deps, asked } = await setup();
    await applySync(none, deps);
    expect(asked()).toBe(0);
  });

  it('says how many changes were saved when it stops', async () => {
    const { google, deps } = await setup();
    const stale = lotFromFields({ id: 'gone', code: 'X' }, 2);
    const error = await applySync({ lotOps: [addLot('A'), { kind: 'update', lot: stale, label: 'Update X', fields: { name: 'y' } }], roastAdds: [roastFields('R1')], roastUpdates: [], roastRemovals: [], roastRestores: [] }, deps).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ImportStopped);
    expect(error).toMatchObject({ saved: 1, total: 3 });

    google.failWhen.push(() => 500);
    expect(await applySync({ ...none, roastAdds: [roastFields('R9')] }, deps).catch((e: unknown) => e)).toMatchObject({ saved: 0, total: 1 });
  });
});

describe('summaryOf and changeCount', () => {
  it('describes what was saved', () => {
    expect(summaryOf({ lotsAdded: 2, lotsUpdated: 1, roastsAdded: 38, roastsUpdated: 1, roastsRemoved: 0, roastsRestored: 0 })).toBe('dodano 2 dostawy, zaktualizowano 1 dostawę, dodano 38 wypałów, zaktualizowano 1 wypał');
    expect(summaryOf({ lotsAdded: 0, lotsUpdated: 0, roastsAdded: 0, roastsUpdated: 0, roastsRemoved: 0, roastsRestored: 0 })).toBe('nic się nie zmieniło');
    expect(summaryOf({ lotsAdded: 0, lotsUpdated: 0, roastsAdded: 0, roastsUpdated: 0, roastsRemoved: 53, roastsRestored: 1 })).toBe('usunięto 53 próbki, przywrócono 1 wypał');
  });

  it('counts the changes', () => {
    expect(changeCount({ lotOps: [addLot('A')], roastAdds: [roastFields('R1'), roastFields('R2')], roastUpdates: [], roastRemovals: [], roastRestores: [] })).toBe(3);
    const roast = roastFromFields({ id: 'K1' }, 2);
    expect(changeCount({ ...none, roastRemovals: [roast], roastRestores: [{ roast, fields: {} }] })).toBe(2);
  });
});
