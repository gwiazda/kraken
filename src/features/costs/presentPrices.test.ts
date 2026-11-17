import { describe, expect, it } from 'vitest';
import { lotFromFields } from '../lots';
import { DEFAULT_SETTINGS, bagCostFromFields } from './model';
import { priceFromFields } from './modelPrices';
import { bagSizeViews, lotCards } from './present';
import { priceListRows } from './presentPrices';

const lot = (id: string, o: Record<string, string> = {}) =>
  lotFromFields(
    { id, code: `KENYA-${id}`, name: 'Kegwa', country: 'Kenya', delivery_date: '2026-09-08', quantity_kg: '60', coffee_price_net_pln: '4500', delivery_cost_net_pln: '120', ...o },
    2,
  );
const price = (row: number, o: Record<string, string> = {}) =>
  priceFromFields({ id: `P${row}`, country: 'Kenya', coffee_name: 'Kegwa', bag_size_g: '250', price_gross_pln: '74', valid_from: '2026-11-01', ...o }, row);
const sizes = bagSizeViews([bagCostFromFields({ id: 'C', bag_size_id: '250', item: 'Bag', cost_net_pln: '1.5' }, 2)]).views;
const cardsOf = (lots: ReturnType<typeof lot>[]) => lotCards(lots, [], [], sizes, DEFAULT_SETTINGS).cards;
const TODAY = '2026-11-16';

describe('priceListRows', () => {
  it('shows one row per coffee: lots with the same country and name are one coffee, suggestions from the newest lot', () => {
    const lots = [lot('OLD', { delivery_date: '2026-03-01', coffee_price_net_pln: '3000' }), lot('NEW', { name: ' kegwa ' }), lot('ETH', { country: 'Ethiopia', name: 'Guji' })];
    const { rows } = priceListRows(cardsOf(lots), [], DEFAULT_SETTINGS, TODAY, null);
    expect(rows.map((r) => [r.title, r.suggestionsFrom])).toEqual([
      ['Ethiopia · Guji', 'KENYA-ETH'],
      ['Kenya · kegwa', 'KENYA-NEW'],
    ]);
    // The hand-checked example (Costs & prices): 250 g at 2×, 2,5×, 3× → 59, 74, 89 zł.
    expect(rows[1]?.cells[0]?.suggestions).toEqual([
      { markup: '2×', grosze: 5900, text: '59 zł' },
      { markup: '2,5×', grosze: 7400, text: '74 zł' },
      { markup: '3×', grosze: 8900, text: '89 zł' },
    ]);
    expect(rows[1]?.cells.map((c) => c.label)).toEqual(['250 g', '500 g', '1 kg']);
  });

  it('shows the main price gross with its net, and nothing where no price is set', () => {
    const { rows } = priceListRows(cardsOf([lot('L1')]), [price(2)], DEFAULT_SETTINGS, TODAY, null);
    expect(rows[0]?.cells.map((c) => [c.main, c.other, c.since])).toEqual([
      ['74 zł', '60,16 zł net', 'since 2026-11-01'],
      ['', '', ''],
      ['', '', ''],
    ]);
  });

  it('shows wholesale prices net, rounded to whole złoty, with the gross for the invoice', () => {
    const { rows } = priceListRows(cardsOf([lot('L1')]), [price(2)], DEFAULT_SETTINGS, TODAY, 150);
    expect(rows[0]?.cells[0]).toMatchObject({ main: '51 zł net', other: '62,73 zł gross' });
  });

  it('has no suggestions when the lot cannot be calculated, leaves deleted lots out, and reports unreadable rows', () => {
    const lots = [lot('A', { coffee_price_net_pln: '' }), lot('GONE', { country: 'Peru', deleted_at: '2026-11-01T00:00:00.000Z' })];
    const { rows, problems } = priceListRows(cardsOf(lots), [price(2, { price_gross_pln: 'x' })], DEFAULT_SETTINGS, TODAY, null);
    expect(rows.map((r) => [r.title, r.suggestionsFrom, r.cells[0]?.suggestions.length, r.cells[0]?.main])).toEqual([['Kenya · Kegwa', '', 0, '']]);
    expect(problems).toEqual(['Row 2 of the Price list tab has the price "x", which Kraken cannot read, so it is left out.']);
  });
});
