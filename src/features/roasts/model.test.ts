import { describe, expect, it } from 'vitest';
import { SAFETY_COLUMNS } from '../../core/records';
import { columnsOf } from '../../schema';
import { ROASTS_TAB, ROAST_COLUMNS, gramsText, roastFromFields, roastLossPermille, roastTimeText, roastedGramsText, sortRoastsOldestFirst, roastsCount } from './model';

const roast = (fields: Record<string, string> = {}, row = 2) =>
  roastFromFields(
    {
      id: 'r1',
      roasted_at: '2026-11-03T08:15:00.000Z',
      roast_name: 'Kenia 03.11.2026-1',
      green_g: '1200',
      roasted_g: '1026.5',
      lot_id: '',
      sample: '',
      notes: '',
      roastime_roast_id: 'RT1',
      roastime_bean_id: 'B1',
      deleted_at: '',
      ...fields,
    },
    row,
  );

describe('the Roasts columns', () => {
  it('match the Roasts tab the migrations create', () => {
    expect([...ROAST_COLUMNS, ...SAFETY_COLUMNS].sort()).toEqual(columnsOf(ROASTS_TAB).sort());
  });
});

describe('roastFromFields', () => {
  it('reads weights in grams (roasted with one decimal)', () => {
    expect(roast()).toMatchObject({
      greenGrams: 1200,
      roastedDecigrams: 10265,
      roastedAt: new Date('2026-11-03T08:15:00.000Z'),
      name: 'Kenia 03.11.2026-1',
      sample: false,
      roastime: { roastId: 'RT1', beanId: 'B1' },
      problems: [],
    });
  });

  it('reads the sample mark in a few spellings', () => {
    for (const mark of ['yes', 'YES', 'true', '1']) expect(roast({ sample: mark }).sample).toBe(true);
    for (const mark of ['', 'no', 'x']) expect(roast({ sample: mark }).sample).toBe(false);
  });

  it('keeps a roast with broken cells and says what is wrong', () => {
    const broken = roast({ green_g: '1,2 kg', roasted_at: 'yesterday' }, 9);
    expect(broken.greenGrams).toBeNull();
    expect(broken.roastedAt).toBeNull();
    expect(broken.problems).toEqual([
      'Czas wypału „yesterday” w wierszu 9 to nie czas, który Kraken umie odczytać.',
      'Waga zielonej „1,2 kg” w wierszu 9 to nie liczba, którą Kraken umie odczytać.',
    ]);
  });

  it('treats an empty roasted weight as not entered', () => {
    expect(roast({ roasted_g: '' }).roastedDecigrams).toBeNull();
  });
});

describe('roastLossPermille', () => {
  it('is (green − roasted) ÷ green, in tenths of a percent', () => {
    expect(roastLossPermille({ greenGrams: 1200, roastedDecigrams: 10200 })).toBe(150); // 15,0 %
    expect(roastLossPermille({ greenGrams: 1200, roastedDecigrams: 10265 })).toBe(145); // 14,46 → 14,5 %
  });

  it('is unknown without both weights', () => {
    expect(roastLossPermille({ greenGrams: 1200, roastedDecigrams: null })).toBeNull();
    expect(roastLossPermille({ greenGrams: 0, roastedDecigrams: 100 })).toBeNull();
    expect(roastLossPermille({ greenGrams: null, roastedDecigrams: 100 })).toBeNull();
  });
});

describe('text helpers', () => {
  it('writes grams', () => {
    expect(gramsText(1200)).toBe('1200');
    expect(roastedGramsText(10265)).toBe('1026.5');
    expect(roastedGramsText(10260)).toBe('1026');
  });

  it('shows the roast time in local time', () => {
    expect(roastTimeText(new Date(2026, 10, 3, 9, 5))).toBe('03.11.2026 09:05');
    expect(roastTimeText(null)).toBe('');
  });

  it('sorts oldest first, roasts without a time last', () => {
    const list = [roast({ id: 'b', roasted_at: '2026-11-05T08:00:00Z' }), roast({ id: 'c', roasted_at: '' }), roast({ id: 'a', roasted_at: '2026-11-01T08:00:00Z' })];
    expect(sortRoastsOldestFirst(list).map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('validateRoastForm', () => {
  const form = (o: Partial<import('./model').RoastForm> = {}) => ({ date: '2026-11-03', time: '09:15', name: ' Kenia ', greenG: '1200', roastedG: '1026,5', lotId: 'L1', sample: false, notes: '', ...o });

  it('stores a roast entered by hand, time in UTC, weights in grams', async () => {
    const { validateRoastForm } = await import('./model');
    const result = validateRoastForm(form(), true, ['L1']);
    expect(result).toEqual({
      ok: true,
      fields: {
        lot_id: 'L1',
        sample: '',
        notes: '',
        roasted_at: new Date(2026, 10, 3, 9, 15).toISOString(),
        roast_name: 'Kenia',
        green_g: '1200',
        roasted_g: '1026.5',
      },
    });
  });

  it('for a RoasTime roast stores only lot, sample and notes', async () => {
    const { validateRoastForm } = await import('./model');
    expect(validateRoastForm(form({ greenG: 'nonsense', sample: true }), false, ['L1'])).toEqual({ ok: true, fields: { lot_id: 'L1', sample: 'yes', notes: '' } });
  });

  it('explains wrong values', async () => {
    const { validateRoastForm } = await import('./model');
    const result = validateRoastForm(form({ date: '2026-02-30', greenG: '1200,5', roastedG: '1300', lotId: 'nope' }), true, ['L1']);
    expect(result.ok ? {} : result.errors).toEqual({
      lotId: 'Wybierz jedną z dostaw z listy.',
      date: 'Wybierz prawdziwą datę.',
      greenG: 'Wpisz pełne gramy, np. 1200.',
    });
    const heavy = validateRoastForm(form({ roastedG: '1300' }), true, ['L1']);
    expect(heavy.ok ? '' : heavy.errors.roastedG).toBe('Waga palonej kawy nie może być większa niż zielonej.');
    const empty = validateRoastForm(form({ date: '', greenG: '' }), true, []);
    expect(empty.ok ? {} : empty.errors).toMatchObject({ date: 'Wybierz datę wypału.', greenG: 'Wpisz wagę zielonej kawy w gramach.' });
  });

  it('round-trips: a roast opened and saved unchanged keeps its values', async () => {
    const { formFromRoast, validateRoastForm } = await import('./model');
    const original = roast({ roasted_at: new Date(2026, 10, 3, 9, 15).toISOString(), roastime_roast_id: '' });
    const result = validateRoastForm(formFromRoast(original), true, []);
    expect(result.ok && result.fields).toMatchObject({ roasted_at: original.source.roasted_at, green_g: '1200', roasted_g: '1026.5' });
  });
});

describe('roastsCount', () => {
  it('says the number with the right Polish word', () => {
    expect([1, 2, 5, 12, 22, 0].map(roastsCount)).toEqual(['1 wypał', '2 wypały', '5 wypałów', '12 wypałów', '22 wypały', '0 wypałów']);
  });
});
