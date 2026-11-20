import { describe, expect, it } from 'vitest';
import { lotFromFields } from '../lots';
import { allocate } from './allocation';
import { roastFromFields } from './model';
import { formatLoss, roastListRows } from './present';

const lots = [
  lotFromFields({ id: 'L1', code: 'KENYA-26-09', name: 'Kenya Kegwa', delivery_date: '2026-09-01', quantity_kg: '1', roastime_bean_id: 'B1', roastime_container_id: 'C1' }, 2),
  lotFromFields({ id: 'L2', code: 'KENYA-26-10', name: 'Kenya Kegwa', delivery_date: '2026-10-01', quantity_kg: '10', roastime_bean_id: 'B1', roastime_container_id: 'C2' }, 3),
];
const roast = (id: string, fields: Record<string, string> = {}) =>
  roastFromFields({ id, roasted_at: '2026-10-05T08:00:00.000Z', roast_name: `Roast ${id}`, green_g: '1200', roasted_g: '1020', roastime_roast_id: `RT-${id}`, roastime_bean_id: 'B1', ...fields }, 2);
const rows = (roasts: ReturnType<typeof roast>[], showDeleted = false) => roastListRows(roasts, lots, allocate(lots, roasts), showDeleted);

describe('formatLoss', () => {
  it.each([
    [150, '15,0 %'],
    [145, '14,5 %'],
    [-3, '−0,3 %'],
    [null, '—'],
  ])('%s -> %s', (permille, text) => {
    expect(formatLoss(permille)).toBe(text);
  });
});

describe('roastListRows', () => {
  it('shows a roast with its coffee, weights, loss and the lots it used', () => {
    const [row] = rows([roast('a')]);
    expect(row).toMatchObject({
      name: 'Roast a',
      coffee: 'Kenya Kegwa',
      green: '1,2 kg',
      roasted: '1,02 kg',
      loss: '15,0 %',
      lots: 'KENYA-26-09 1 kg + KENYA-26-10 0,2 kg',
      counted: true,
      needsLot: false,
      source: 'RoasTime',
    });
  });

  it('gives the filters the same values as shown: day, grams (roasted rounded to the gram), loss, lot codes, badges', () => {
    // 1199,6 g roasted is shown as 1,2 kg, so "from 1,2 kg" must find it: the filter gets 1200 g.
    const [row] = rows([roast('a', { roasted_g: '1199.6', roasted_at: '2026-10-05T08:00:00.000Z' })]);
    expect(row).toMatchObject({ roasted: '1,2\u00a0kg', roastedGrams: 1200, greenGrams: 1200, day: '2026-10-05', lotCodes: ['KENYA-26-09', 'KENYA-26-10'], marks: [] });
    expect(row?.lossTenths).toBe(0); // 1200 g → 1199,6 g: under 0,1 %
    const [sample] = rows([roast('b', { roastime_bean_id: '', sample: 'yes' })]);
    expect(sample).toMatchObject({ lotCodes: ['Not counted: no coffee chosen'], marks: ['Sample'] });
    const [needs] = rows([roast('c', { roastime_bean_id: '' })]);
    expect(needs?.marks).toEqual(['Needs a lot']);
    const [chosen] = rows([roast('d', { lot_id: 'L2', roasted_at: '2026-09-20T08:00:00.000Z' })]);
    expect(chosen?.marks).toEqual(['Before delivery', 'Chosen']);
  });

  it('asks for a lot when there is no coffee, unless it is a sample', () => {
    const [plain] = rows([roast('a', { roastime_bean_id: '' })]);
    expect(plain).toMatchObject({ coffee: 'No coffee chosen', lots: 'Not counted: no coffee chosen', counted: false, needsLot: true });
    const [sample] = rows([roast('a', { roastime_bean_id: '', sample: 'yes' })]);
    expect(sample).toMatchObject({ needsLot: false, sample: true });
  });

  it('shows the chosen lot and flags a roast before its delivery', () => {
    const [row] = rows([roast('a', { lot_id: 'L2', roasted_at: '2026-09-20T08:00:00.000Z' })]);
    expect(row).toMatchObject({ lots: 'KENYA-26-10', chosen: true, beforeDelivery: true });
  });

  it('lists newest first and hides deleted roasts unless asked', () => {
    const list = [roast('old', { roasted_at: '2026-10-01T08:00:00.000Z' }), roast('new', { roasted_at: '2026-10-09T08:00:00.000Z' }), roast('gone', { deleted_at: '2026-11-01T00:00:00.000Z' })];
    expect(rows(list).map((r) => r.roast.id)).toEqual(['new', 'old']);
    expect(rows(list, true).map((r) => r.roast.id)).toEqual(['new', 'gone', 'old']);
  });

  it('marks roasts entered by hand', () => {
    expect(rows([roast('a', { roastime_roast_id: '' })])[0]?.source).toBe('By hand');
  });
});
