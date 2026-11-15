import { describe, expect, it } from 'vitest';
import { roastFromFields } from '../roasts';
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

  it('adds a roast without a coffee (it then needs a lot or a sample mark)', () => {
    expect(planRoasts([rt({ beanId: '' })], []).added[0]?.fields.roastime_bean_id).toBe('');
  });

  it('skips roasts with no green weight or no time, and lists them', () => {
    const plan = planRoasts([rt({ id: 'a', greenGrams: 0 }), rt({ id: 'b', greenGrams: null }), rt({ id: 'c', roastedAt: null, name: '' })], []);
    expect(plan.added).toEqual([]);
    expect(plan.skipped).toEqual([
      'Roast without a name (no date): no roast time',
      'Kenia 03.11.2026-1 (2026-11-03): no green weight',
      'Kenia 03.11.2026-1 (2026-11-03): no green weight',
    ]);
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
    expect(plan.problems).toEqual(['RoasTime now has no green weight for Roast without a name (2026-11-03); Kraken keeps its value.']);
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
});
