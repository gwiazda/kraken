import { describe, expect, it } from 'vitest';
import { roastFromFields, roastTimeText } from '../roasts';
import type { RoastimeRoast } from './model';
import { coffeesOf, planRoasts } from './roastPlan';

const coffees = { delivered: new Set(['B1', 'B2']), withLot: new Set(['B1', 'B2']) };

const rt = (o: Partial<RoastimeRoast> = {}): RoastimeRoast => ({
  id: 'R1',
  roastedAt: new Date('2026-11-03T08:15:00.000Z'),
  name: 'Kenia 03.11.2026-1',
  beanId: 'B1',
  greenGrams: 1200,
  roastedDecigrams: 10265,
  comment: '',
  ...o,
});
const kraken = (o: Record<string, string> = {}, row = 2) =>
  roastFromFields(
    {
      id: `K${row}`,
      roasted_at: '2026-11-03T08:15:00.000Z',
      roast_name: 'Kenia 03.11.2026-1',
      green_g: '1200',
      roasted_g: '1026.5',
      lot_id: '',
      sample: '',
      notes: '',
      roastime_roast_id: 'R1',
      roastime_bean_id: 'B1',
      deleted_at: '',
      ...o,
    },
    row,
  );

describe('planRoasts', () => {
  it('adds a new roast with the summary fields and RoasTime comment as notes', () => {
    const plan = planRoasts([rt({ comment: 'a bit fast' })], [], coffees);
    expect(plan.added).toEqual([
      {
        roastime: rt({ comment: 'a bit fast' }),
        fields: {
          roasted_at: '2026-11-03T08:15:00.000Z',
          roast_name: 'Kenia 03.11.2026-1',
          green_g: '1200',
          roasted_g: '1026.5',
          roastime_bean_id: 'B1',
          roastime_roast_id: 'R1',
          lot_id: '',
          sample: '',
          notes: 'a bit fast',
        },
      },
    ]);
    expect(plan).toMatchObject({ changed: [], unchanged: 0, skipped: [], goneFromRoastime: [], problems: [] });
  });

  it('does not import a roast without a coffee (a sample), and lists it', () => {
    const plan = planRoasts([rt({ beanId: '' })], [], coffees);
    expect(plan.added).toEqual([]);
    expect(plan.samples).toEqual([`Kenia 03.11.2026-1 (${roastTimeText(new Date('2026-11-03T08:15:00.000Z'))}): no coffee chosen`]);
    expect(plan.skipped).toEqual([]);
  });

  it('a roast with no green weight is listed as skipped, not as a sample', () => {
    const plan = planRoasts([rt({ beanId: '', greenGrams: 0 })], [], coffees);
    expect(plan.samples).toEqual([]);
    expect(plan.skipped).toHaveLength(1);
  });

  it('removes a roast imported earlier without a coffee, if it was not touched in Kraken', () => {
    const sample = kraken({ roastime_bean_id: '' });
    const plan = planRoasts([rt({ beanId: '' })], [sample], coffees);
    expect(plan.removed).toEqual([sample]);
    expect(plan).toMatchObject({ added: [], changed: [], unchanged: 0, goneFromRoastime: [] });
  });

  it('treats the imported RoasTime comment as untouched notes', () => {
    const sample = kraken({ roastime_bean_id: '', notes: 'a bit fast' });
    expect(planRoasts([rt({ beanId: '', comment: 'a bit fast' })], [sample], coffees).removed).toEqual([sample]);
  });

  it('keeps a roast without a coffee that was given a lot, a sample mark or own notes in Kraken', () => {
    const owned: Record<string, string>[] = [{ lot_id: 'L1' }, { sample: 'yes' }, { notes: 'for a café' }];
    for (const own of owned) {
      const plan = planRoasts([rt({ beanId: '' })], [kraken({ roastime_bean_id: '', ...own })], coffees);
      expect(plan.removed).toEqual([]);
      expect(plan.keptSamples).toHaveLength(1);
      expect(plan.unchanged).toBe(1);
    }
  });

  it('removes a roast whose coffee was taken away in RoasTime later (it is a sample now)', () => {
    const roast = kraken();
    expect(planRoasts([rt({ beanId: '' })], [roast], coffees).removed).toEqual([roast]);
  });

  it('brings back a roast removed for having no coffee once RoasTime has its coffee', () => {
    const removed = kraken({ roastime_bean_id: '', deleted_at: '2026-11-15T10:00:00.000Z' });
    const plan = planRoasts([rt({ beanId: 'B2', roastedDecigrams: 10300 })], [removed], coffees);
    expect(plan.restored).toEqual([
      { roast: removed, fields: { roasted_g: '1030', roastime_bean_id: 'B2' }, changes: ['Roasted weight: 1,027\u00a0kg → 1,03\u00a0kg', 'Coffee: chosen in RoasTime'] },
    ]);
    expect(plan).toMatchObject({ added: [], changed: [], removed: [] });
  });

  it('does not bring back a deleted roast that had a coffee, or that still has none', () => {
    const deletedWithCoffee = kraken({ deleted_at: '2026-11-10T00:00:00.000Z' });
    expect(planRoasts([rt({ beanId: 'B2' })], [deletedWithCoffee], coffees).restored).toEqual([]);
    const deletedSample = kraken({ roastime_bean_id: '', deleted_at: '2026-11-10T00:00:00.000Z' });
    const plan = planRoasts([rt({ beanId: '' })], [deletedSample], coffees);
    expect(plan).toMatchObject({ restored: [], removed: [], added: [] });
    expect(plan.samples).toHaveLength(1); // still counted as a sample in the preview
  });

  it('treats a roast whose coffee has no delivery in RoasTime as a sample', () => {
    const plan = planRoasts([rt({ beanId: 'B4' })], [], coffees);
    expect(plan.added).toEqual([]);
    expect(plan.samples).toEqual([`Kenia 03.11.2026-1 (${roastTimeText(new Date('2026-11-03T08:15:00.000Z'))}): its coffee has no delivery in RoasTime`]);
  });

  it('removes a roast imported earlier whose coffee has no delivery, also when RoasTime moved it to such a coffee', () => {
    const sample = kraken({ roastime_bean_id: 'B4' });
    expect(planRoasts([rt({ beanId: 'B4' })], [sample], coffees).removed).toEqual([sample]);
    const moved = kraken({ roastime_bean_id: 'B1' });
    expect(planRoasts([rt({ beanId: 'B4' })], [moved], coffees)).toMatchObject({ removed: [moved], changed: [] });
  });

  it('never offers back a roast deleted by hand whose coffee had a lot, even if RoasTime moves it to a new coffee', () => {
    const deleted = kraken({ roastime_bean_id: 'B1', deleted_at: '2026-11-15T10:00:00.000Z' });
    const newCoffee = { delivered: new Set(['B1', 'B5']), withLot: new Set(['B1']) };
    expect(planRoasts([rt({ beanId: 'B5' })], [deleted], newCoffee).restored).toEqual([]);
  });

  it("offers back a removed roast when its coffee's first delivery comes in this sync", () => {
    const removed = kraken({ roastime_bean_id: 'B4', deleted_at: '2026-11-15T10:00:00.000Z' });
    const firstDelivery = { delivered: new Set(['B1', 'B4']), withLot: new Set(['B1']) };
    expect(planRoasts([rt({ beanId: 'B4' })], [removed], firstDelivery).restored.map((r) => r.roast)).toEqual([removed]);
    // The coffee already had a lot: the roast was deleted for another reason, so it is left alone.
    const hadLot = { delivered: new Set(['B1', 'B4']), withLot: new Set(['B1', 'B4']) };
    expect(planRoasts([rt({ beanId: 'B4' })], [removed], hadLot).restored).toEqual([]);
  });

  it('knows the delivered coffees from the RoasTime folder and the coffees with a lot from Kraken', () => {
    const result = coffeesOf(
      [{ beanId: 'B1', deleted: false }, { beanId: 'B6', deleted: true }, { beanId: '', deleted: false }],
      [{ roastime: { beanId: 'B2' } }, { roastime: { beanId: '' } }],
    );
    // B2: a lot in Kraken counts even if its file is missing from the folder; B6: deleted in RoasTime, never a lot.
    expect(result).toEqual({ delivered: new Set(['B2', 'B1']), withLot: new Set(['B2']) });
  });

  it('lists a kept sample, and still gives it the RoasTime changes', () => {
    const kept = kraken({ roastime_bean_id: '', lot_id: 'L1' });
    const plan = planRoasts([rt({ beanId: '', roastedDecigrams: 10300 })], [kept], coffees);
    expect(plan.keptSamples).toEqual([kept]);
    expect(plan.changed.map((c) => c.fields)).toEqual([{ roasted_g: '1030' }]);
  });

  it('removes every untouched copy of a sample imported twice', () => {
    const a = kraken({ roastime_bean_id: '' }, 2);
    const b = kraken({ roastime_bean_id: '' }, 3);
    expect(planRoasts([rt({ beanId: '' })], [a, b], coffees).removed).toEqual([a, b]);
  });

  it('ignores line-ending and space differences when comparing notes with the RoasTime comment', () => {
    const sample = kraken({ roastime_bean_id: '', notes: 'line one\nline two' });
    expect(planRoasts([rt({ beanId: '', comment: 'line one\r\nline two ' })], [sample], coffees).removed).toEqual([sample]);
  });

  it('skips roasts with no green weight or no time, and lists them', () => {
    const plan = planRoasts([rt({ id: 'a', greenGrams: 0 }), rt({ id: 'b', greenGrams: null }), rt({ id: 'c', roastedAt: null, name: '' })], [], coffees);
    expect(plan.added).toEqual([]);
    const at = roastTimeText(new Date('2026-11-03T08:15:00.000Z')); // local time, like the Roasts page
    expect(plan.skipped).toEqual(['Roast without a name (no date): no roast time', `Kenia 03.11.2026-1 (${at}): no green weight`, `Kenia 03.11.2026-1 (${at}): no green weight`]);
  });

  it('counts a roast already in Kraken with the same values as unchanged', () => {
    expect(planRoasts([rt()], [kraken()], coffees)).toMatchObject({ added: [], changed: [], unchanged: 1 });
  });

  it('lists what changed in RoasTime, and never touches lot, sample or notes', () => {
    const mine = kraken({ lot_id: 'L1', sample: 'yes', notes: 'mine', roasted_g: '' });
    const plan = planRoasts([rt({ roastedDecigrams: 10300, beanId: 'B2', name: 'Kenia AA' })], [mine], coffees);
    expect(plan.changed).toEqual([
      {
        roast: mine,
        fields: { roast_name: 'Kenia AA', roasted_g: '1030', roastime_bean_id: 'B2' },
        changes: ['Name: Kenia 03.11.2026-1 → Kenia AA', 'Roasted weight: (empty) → 1,03 kg', 'Coffee: a different coffee was chosen in RoasTime'],
      },
    ]);
  });

  it('never empties a Kraken value, and keeps the green weight if RoasTime lost it', () => {
    const plan = planRoasts([rt({ roastedDecigrams: null, greenGrams: 0, name: '' })], [kraken()], coffees);
    expect(plan.changed).toEqual([]);
    expect(plan.problems).toEqual([`RoasTime now has no green weight for Roast without a name (${roastTimeText(new Date('2026-11-03T08:15:00.000Z'))}); Kraken keeps its value.`]);
  });

  it('keeps roasts that are no longer in RoasTime, and leaves deleted ones alone', () => {
    const gone = kraken({ roastime_roast_id: 'OLD' }, 3);
    const deleted = kraken({ deleted_at: '2026-11-10T00:00:00.000Z', roast_name: 'x' }, 4);
    const byHand = kraken({ roastime_roast_id: '' }, 5);
    const plan = planRoasts([rt()], [gone, deleted, byHand], coffees);
    expect(plan.goneFromRoastime).toEqual([gone]);
    expect(plan.added).toEqual([]); // R1 is the deleted one: not added again
    expect(plan.changed).toEqual([]);
  });

  it('reports the same RoasTime roast twice in Kraken', () => {
    const plan = planRoasts([rt()], [kraken({}, 2), kraken({}, 7)], coffees);
    expect(plan.problems).toEqual(['2 roasts in Kraken (rows 2, 7) are the same RoasTime roast. Delete the extra ones.']);
    expect(plan.unchanged).toBe(1);
  });

  it('uses a roast that is in the folder twice only once', () => {
    const plan = planRoasts([rt(), rt()], [], coffees);
    expect(plan.added).toHaveLength(1);
    expect(plan.problems[0]).toContain('is in the RoasTime folder twice; Kraken uses it once.');
  });

  it('shows a weight typed by hand that Kraken cannot read as it is, instead of failing', () => {
    const plan = planRoasts([rt({ greenGrams: 1150, roastedDecigrams: 9800 })], [kraken({ green_g: '1 200 g', roasted_g: '1026,5' })], coffees);
    expect(plan.changed[0]?.changes).toEqual(['Green weight: "1 200 g" → 1,15\u00a0kg', 'Roasted weight: 1,027\u00a0kg → 0,98\u00a0kg']);
  });
});
