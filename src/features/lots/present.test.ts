import { describe, expect, it } from 'vitest';
import { lotFromFields, type LotForm } from './model';
import { codeAfterChange, deletedCount, deletedNote, formPricePerKg, lotListRows } from './present';

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
      pricePerKg: '77,01 zł',
      priceMissing: false,
      supplier: '—',
      problems: [],
    });
  });

  it('marks a lot without a price, and shows no price per kg', () => {
    const [row] = lotListRows([lot({ coffee_price_net_pln: '' })]);
    expect(row?.priceMissing).toBe(true);
    expect(row?.pricePerKg).toBeNull();
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

describe('formPricePerKg', () => {
  it('calculates live while typing', () => {
    expect(formPricePerKg(form())).toBe('77,01 zł');
    expect(formPricePerKg(form({ deliveryCost: '' }))).toBe('75,00 zł');
  });

  it('shows nothing until price and quantity are readable', () => {
    expect(formPricePerKg(form({ coffeePrice: '' }))).toBeNull();
    expect(formPricePerKg(form({ quantityKg: '6x' }))).toBeNull();
    expect(formPricePerKg(form({ quantityKg: '0' }))).toBeNull();
    expect(formPricePerKg(form({ deliveryCost: 'abc' }))).toBeNull();
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
