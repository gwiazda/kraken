import { describe, expect, it } from 'vitest';
import { lotFromFields, type LotForm } from './model';
import { codeAfterChange, deletedCount, deletedNote, lotListRows } from './present';

const lot = (fields: Record<string, string>, row = 2) =>
  lotFromFields(
    {
      id: `id-${row}`,
      code: 'KENYA-26-11',
      name: 'Kenya Kegwa',
      country: 'Kenya',
      delivery_date: '2026-11-03',
      quantity_kg: '60',
      coffee_price_net_pln: '4500',
      delivery_cost_net_pln: '120.5',
      supplier: '',
      deleted_at: '',
      ...fields,
    },
    row,
  );

const form = (overrides: Partial<LotForm> = {}): LotForm => ({
  code: '',
  name: '',
  country: 'Kenya',
  region: '',
  altitude: '',
  process: '',
  variety: '',
  supplier: '',
  deliveryDate: '2026-11-03',
  quantityKg: '60',
  coffeePrice: '4500',
  deliveryCost: '120,50',
  notes: '',
  ...overrides,
});

describe('lotListRows', () => {
  it('shows a lot with its numbers formatted', () => {
    const [row] = lotListRows([lot({})]);
    expect(row).toMatchObject({
      code: 'KENYA-26-11',
      name: 'Kenya Kegwa',
      country: 'Kenya',
      delivered: '2026-11-03',
      quantity: '60 kg',
      supplier: '—',
      source: 'By hand',
      stockLeft: '60\u00a0kg',
      overdrawn: false,
      problems: [],
    });
  });

  it('shows lots imported from RoasTime as such', () => {
    expect(lotListRows([lot({ roastime_container_id: 'C1' })])[0]?.source).toBe('RoasTime');
  });

  it('hides deleted lots and puts the newest delivery first', () => {
    const rows = lotListRows([
      lot({ code: 'OLD', delivery_date: '2026-09-01' }, 2),
      lot({ code: 'GONE', deleted_at: '2026-11-15T10:00:00.000Z' }, 3),
      lot({ code: 'NEW', delivery_date: '2026-11-10' }, 4),
    ]);
    expect(rows.map((r) => r.code)).toEqual(['NEW', 'OLD']);
  });

  it('shows a dash for empty values and passes problems on', () => {
    const [row] = lotListRows([lot({ code: '', quantity_kg: 'abc' })]);
    expect(row?.code).toBe('—');
    expect(row?.quantity).toBe('—');
    expect(row?.problems).toEqual(['Quantity "abc" in row 2 is not a number Kraken can read.']);
  });
});

describe('stock left', () => {
  it('shows the green coffee left per lot', () => {
    const [row] = lotListRows([lot({})], false, new Map([['id-2', { usedGrams: 38500, leftGrams: 21500 }]]));
    expect(row).toMatchObject({ stockLeft: '21,5\u00a0kg', overdrawn: false, stockNote: '' });
  });

  it('shows below zero when more was roasted than delivered, with a note', () => {
    const [row] = lotListRows([lot({})], false, new Map([['id-2', { usedGrams: 62400, leftGrams: -2400 }]]));
    expect(row).toMatchObject({
      stockLeft: '−2,4\u00a0kg',
      overdrawn: true,
      stockNote: 'KENYA-26-11: 2,4\u00a0kg more roasted than delivered. Check the lots, or the coffee chosen in RoasTime.',
    });
  });

  it('shows the delivered kg when nothing was counted yet, and a dash when it is unknown', () => {
    expect(lotListRows([lot({})])[0]?.stockLeft).toBe('60\u00a0kg');
    expect(lotListRows([lot({ quantity_kg: '' })], false, new Map([['id-2', { usedGrams: 0, leftGrams: null }]]))[0]?.stockLeft).toBe('—');
  });
});

describe('deleted lots', () => {
  const lots = [
    lot({ code: 'ACTIVE', delivery_date: '2026-11-01' }, 2),
    lot({ code: 'GONE', delivery_date: '2026-11-05', deleted_at: '2026-11-16T09:30:00.000Z' }, 3),
  ];

  it('are hidden unless "Show deleted" is on', () => {
    expect(lotListRows(lots).map((r) => r.code)).toEqual(['ACTIVE']);
    expect(lotListRows(lots, true).map((r) => [r.code, r.deleted, r.deletedNote])).toEqual([
      ['GONE', true, deletedNote('2026-11-16T09:30:00.000Z')],
      ['ACTIVE', false, ''],
    ]);
  });

  it('show the deleted day on the local calendar, and cope with a non-date typed in the sheet', () => {
    const justAfterMidnight = new Date(2026, 10, 16, 0, 30); // local time
    expect(deletedNote(justAfterMidnight.toISOString())).toBe('Deleted 2026-11-16');
    expect(deletedNote('yes')).toBe('Deleted');
  });

  it('are counted for the switch', () => {
    expect(deletedCount(lots)).toBe(1);
    expect(deletedCount([])).toBe(0);
  });
});

describe('codeAfterChange', () => {
  it('suggests a code while the user has not typed one', () => {
    expect(codeAfterChange(form(), false, [])).toBe('KENYA-26-11');
    expect(codeAfterChange(form(), false, ['KENYA-26-11'])).toBe('KENYA-26-11-B');
    expect(codeAfterChange(form({ country: '' }), false, [])).toBe('');
  });

  it('keeps a code the user typed', () => {
    expect(codeAfterChange(form({ code: 'MY-CODE' }), true, [])).toBe('MY-CODE');
  });
});
