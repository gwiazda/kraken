import { describe, expect, it } from 'vitest';
import { roastFromFields, roastTimeText } from '../roasts';
import type { RoastimeRoast } from './model';
import { planRoasts } from './roastPlan';

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
    const plan = planRoasts([rt({ comment: 'a bit fast' })], []);
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
    const plan = planRoasts([rt({ beanId: '' })], []);
    expect(plan.added).toEqual([]);
    expect(plan.noCoffee).toEqual([`Kenia 03.11.2026-1 (${roastTimeText(new Date('2026-11-03T08:15:00.000Z'))})`]);
    expect(plan.skipped).toEqual([]);
  });

  it('a roast with no green weight is listed as skipped, not as a sample', () => {
    const plan = planRoasts([rt({ beanId: '', greenGrams: 0 })], []);
    expect(plan.noCoffee).toEqual([]);
    expect(plan.skipped).toHaveLength(1);
  });

  it('removes a roast imported earlier without a coffee, if it was not touched in Kraken', () => {
    const sample = kraken({ roastime_bean_id: '' });
    const plan = planRoasts([rt({ beanId: '' })], [sample]);
    expect(plan.removed).toEqual([sample]);
    expect(plan).toMatchObject({ added: [], changed: [], unchanged: 0, goneFromRoastime: [] });
  });

  it('treats the imported RoasTime comment as untouched notes', () => {
    const sample = kraken({ roastime_bean_id: '', notes: 'a bit fast' });
    expect(planRoasts([rt({ beanId: '', comment: 'a bit fast' })], [sample]).removed).toEqual([sample]);
  });

  it('keeps a roast without a coffee that was given a lot, a sample mark or own notes in Kraken', () => {
    const owned: Record<string, string>[] = [{ lot_id: 'L1' }, { sample: 'yes' }, { notes: 'for a café' }];
    for (const own of owned) {
      const plan = planRoasts([rt({ beanId: '' })], [kraken({ roastime_bean_id: '', ...own })]);
      expect(plan.removed).toEqual([]);
      expect(plan.unchanged).toBe(1);
    }
  });

  it('keeps a roast whose coffee was removed in RoasTime later (never empties Kraken)', () => {
    const plan = planRoasts([rt({ beanId: '' })], [kraken()]);
    expect(plan.removed).toEqual([]);
    expect(plan.unchanged).toBe(1);
  });

  it('brings back a roast removed for having no coffee once RoasTime has its coffee', () => {
    const removed = kraken({ roastime_bean_id: '', deleted_at: '2026-11-15T10:00:00.000Z' });
    const plan = planRoasts([rt({ beanId: 'B2', roastedDecigrams: 10300 })], [removed]);
    expect(plan.restored).toEqual([
      { roast: removed, fields: { roasted_g: '1030', roastime_bean_id: 'B2' }, changes: ['Coffee chosen in RoasTime: brought back'] },
    ]);
    expect(plan).toMatchObject({ added: [], changed: [], removed: [] });
  });

  it('does not bring back a deleted roast that had a coffee, or that still has none', () => {
    const deletedWithCoffee = kraken({ deleted_at: '2026-11-10T00:00:00.000Z' });
    expect(planRoasts([rt({ beanId: 'B2' })], [deletedWithCoffee]).restored).toEqual([]);
    const deletedSample = kraken({ roastime_bean_id: '', deleted_at: '2026-11-10T00:00:00.000Z' });
    expect(planRoasts([rt({ beanId: '' })], [deletedSample])).toMatchObject({ restored: [], removed: [], added: [], noCoffee: [] });
  });

  it('skips roasts with no green weight or no time, and lists them', () => {
    const plan = planRoasts([rt({ id: 'a', greenGrams: 0 }), rt({ id: 'b', greenGrams: null }), rt({ id: 'c', roastedAt: null, name: '' })], []);
    expect(plan.added).toEqual([]);
    const at = roastTimeText(new Date('2026-11-03T08:15:00.000Z')); // local time, like the Roasts page
    expect(plan.skipped).toEqual(['Roast without a name (no date): no roast time', `Kenia 03.11.2026-1 (${at}): no green weight`, `Kenia 03.11.2026-1 (${at}): no green weight`]);
  });

  it('counts a roast already in Kraken with the same values as unchanged', () => {
    expect(planRoasts([rt()], [kraken()])).toMatchObject({ added: [], changed: [], unchanged: 1 });
  });

  it('lists what changed in RoasTime, and never touches lot, sample or notes', () => {
    const mine = kraken({ lot_id: 'L1', sample: 'yes', notes: 'mine', roasted_g: '' });
    const plan = planRoasts([rt({ roastedDecigrams: 10300, beanId: 'B2', name: 'Kenia AA' })], [mine]);
    expect(plan.changed).toEqual([
      {
        roast: mine,
        fields: { roast_name: 'Kenia AA', roasted_g: '1030', roastime_bean_id: 'B2' },
        changes: ['Name: Kenia 03.11.2026-1 → Kenia AA', 'Roasted weight: (empty) → 1,03 kg', 'Coffee: a different coffee was chosen in RoasTime'],
      },
    ]);
  });

  it('never empties a Kraken value, and keeps the green weight if RoasTime lost it', () => {
    const plan = planRoasts([rt({ roastedDecigrams: null, greenGrams: 0, name: '' })], [kraken()]);
    expect(plan.changed).toEqual([]);
    expect(plan.problems).toEqual([`RoasTime now has no green weight for Roast without a name (${roastTimeText(new Date('2026-11-03T08:15:00.000Z'))}); Kraken keeps its value.`]);
  });

  it('keeps roasts that are no longer in RoasTime, and leaves deleted ones alone', () => {
    const gone = kraken({ roastime_roast_id: 'OLD' }, 3);
    const deleted = kraken({ deleted_at: '2026-11-10T00:00:00.000Z', roast_name: 'x' }, 4);
    const byHand = kraken({ roastime_roast_id: '' }, 5);
    const plan = planRoasts([rt()], [gone, deleted, byHand]);
    expect(plan.goneFromRoastime).toEqual([gone]);
    expect(plan.added).toEqual([]); // R1 is the deleted one: not added again
    expect(plan.changed).toEqual([]);
  });

  it('reports the same RoasTime roast twice in Kraken', () => {
    const plan = planRoasts([rt()], [kraken({}, 2), kraken({}, 7)]);
    expect(plan.problems).toEqual(['2 roasts in Kraken (rows 2, 7) are the same RoasTime roast. Delete the extra ones.']);
    expect(plan.unchanged).toBe(1);
  });

  it('uses a roast that is in the folder twice only once', () => {
    const plan = planRoasts([rt(), rt()], []);
    expect(plan.added).toHaveLength(1);
    expect(plan.problems[0]).toContain('is in the RoasTime folder twice; Kraken uses it once.');
  });

  it('shows a weight typed by hand that Kraken cannot read as it is, instead of failing', () => {
    const plan = planRoasts([rt({ greenGrams: 1150, roastedDecigrams: 9800 })], [kraken({ green_g: '1 200 g', roasted_g: '1026,5' })]);
    expect(plan.changed[0]?.changes).toEqual(['Green weight: "1 200 g" → 1,15\u00a0kg', 'Roasted weight: 1,027\u00a0kg → 0,98\u00a0kg']);
  });
});
