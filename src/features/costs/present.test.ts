import { describe, expect, it } from 'vitest';
import { lotFromFields } from '../lots';
import { roastFromFields } from '../roasts';
import { DEFAULT_SETTINGS, bagCostFromFields, lotCostFromFields } from './model';
import { bagSizeViews, lotCards, lotLosses, pricingFor, sharesByLot } from './present';

const lot = (id: string, o: Record<string, string> = {}, row = 2) =>
  lotFromFields(
    {
      id,
      code: `KENYA-${id}`,
      name: 'Kegwa',
      country: 'Kenya',
      delivery_date: '2026-09-08',
      quantity_kg: '60',
      coffee_price_net_pln: '4500',
      delivery_cost_net_pln: '120',
      roastime_bean_id: 'B1',
      ...o,
    },
    row,
  );
const roast = (id: string, green: string, roasted: string, o: Record<string, string> = {}) =>
  roastFromFields({ id, roasted_at: '2026-10-01T08:00:00.000Z', roast_name: id, green_g: green, roasted_g: roasted, roastime_bean_id: 'B1', ...o }, 2);

const cost = (sizeId: string, item: string, value: string, deleted = '') => bagCostFromFields({ id: `${sizeId}-${item}`, bag_size_id: sizeId, item, cost_net_pln: value, deleted_at: deleted }, 2);

describe('bagSizeViews', () => {
  it('always shows 250 g, 500 g and 1 kg, with their active items added up', () => {
    const { views, problems } = bagSizeViews([cost('250', 'Bag', '1.2'), cost('250', 'Label', '0.3'), cost('250', 'Old', '9', '2026-11-16'), cost('1000', 'Bag', '2')]);
    expect(views.map((v) => [v.label, v.itemsText])).toEqual([
      ['250 g', '1,50\u00a0zł'],
      ['500 g', 'missing cost'],
      ['1 kg', '2,00\u00a0zł'],
    ]);
    expect(problems).toEqual([]);
  });

  it('marks a size with a cost it cannot read as missing, and reports items of a size Kraken does not use', () => {
    const old = cost('3f2a-old-size', 'Label', '0.3');
    const { views, unplaced, problems } = bagSizeViews([cost('250', 'Bag', 'about 1 zł'), old]);
    expect(views[0]).toMatchObject({ itemsText: 'missing cost', unreadable: true });
    expect(unplaced).toEqual([old]);
    expect(problems).toEqual([
      '1 bag cost item is for a bag size Kraken does not use, so it is left out. Delete it under "Bag costs & settings" and add it again to 250 g, 500 g or 1 kg.',
      'The cost "about 1 zł" of Bag (250 g) cannot be read, so that bag size shows "missing cost". Click it under Packaging & discounts to correct it.',
    ]);
  });
});

describe('lotCards', () => {
  const sizes = bagSizeViews([cost('250', 'Bag', '1.2'), cost('250', 'Label', '0.3')]).views;

  it('shows the calculation of the hand-checked example (default loss: no roasts yet)', () => {
    const { cards } = lotCards([lot('L1')], [], [], sizes, DEFAULT_SETTINGS);
    expect(cards[0]).toMatchObject({
      title: 'KENYA-L1 · Kegwa',
      subtitle: 'delivered 2026-09-08 · Kenya',
      missing: '',
      greenPerKg: '77,00\u00a0zł / kg',
      loss: '15 %',
      lossSource: 'usual loss: no roasts with both weights yet',
      roastedFromKg: '0,85\u00a0kg',
      roastedPerKg: '90,59\u00a0zł / kg',
    });
    expect(cards[0]?.bags).toEqual([
      {
        grams: 250,
        label: '250 g',
        coffee: '22,65\u00a0zł',
        items: '1,50\u00a0zł',
        total: '24,15\u00a0zł',
        missing: false,
        prices: [
          { markup: '2×', suggestedGrossGrosze: 5900, suggestedGross: '59\u00a0zł', suggestedNet: '47,97\u00a0zł', net: '48,29\u00a0zł', gross: '59,40\u00a0zł' },
          { markup: '2,5×', suggestedGrossGrosze: 7400, suggestedGross: '74\u00a0zł', suggestedNet: '60,16\u00a0zł', net: '60,37\u00a0zł', gross: '74,25\u00a0zł' },
          { markup: '3×', suggestedGrossGrosze: 8900, suggestedGross: '89\u00a0zł', suggestedNet: '72,36\u00a0zł', net: '72,44\u00a0zł', gross: '89,10\u00a0zł' },
        ],
      },
      { grams: 500, label: '500 g', coffee: '45,29\u00a0zł', items: 'missing cost', total: 'missing cost', missing: true, prices: [] },
      { grams: 1000, label: '1 kg', coffee: '90,59\u00a0zł', items: 'missing cost', total: 'missing cost', missing: true, prices: [] },
    ]);
  });

  it('uses the average loss of the lot roasts, and the owner value over it', () => {
    const roasts = [roast('R1', '1000', '850'), roast('R2', '1000', '830')];
    expect(lotCards([lot('L1')], roasts, [], sizes, DEFAULT_SETTINGS).cards[0]).toMatchObject({ loss: '16 %', lossSource: 'average of 2 roasts' });
    const own = lotCostFromFields({ id: 'O', lot_id: 'L1', roast_loss_percent: '14.2' }, 2);
    expect(lotCards([lot('L1')], roasts, [own], sizes, DEFAULT_SETTINGS).cards[0]).toMatchObject({ loss: '14,2 %', lossSource: 'your own', ownLoss: own });
  });

  it('reports roasts whose weights give a loss that makes no sense, and uses the default', () => {
    const { cards, problems } = lotCards([lot('L1')], [roast('R1', '1000', '1200')], [], sizes, DEFAULT_SETTINGS);
    expect(cards[0]).toMatchObject({ loss: '15\u00a0%', lossSource: 'usual loss: the roast weights do not make sense' });
    expect(problems).toEqual(['The roasts of KENYA-L1 give a roast loss below 0 % or of 100 % or more, so the default loss is used. Check their weights on the Roasts page.']);
  });

  it('falls back to the average when the saved loss cannot be read, and says so', () => {
    const odd = lotCostFromFields({ id: 'O', lot_id: 'L1', roast_loss_percent: 'a lot' }, 2);
    const { cards, problems } = lotCards([lot('L1')], [], [odd], sizes, DEFAULT_SETTINGS);
    expect(cards[0]?.lossSource).toBe('usual loss: no roasts with both weights yet');
    expect(problems).toEqual(['The roast loss "a lot" saved for KENYA-L1 cannot be read; the average of its roasts is used instead.']);
  });

  it('says what is missing instead of calculating, newest delivery first, without deleted lots', () => {
    const lots = [lot('A', { coffee_price_net_pln: '' }), lot('B', { delivery_date: '2026-10-01', quantity_kg: '' }), lot('C', { deleted_at: '2026-11-01T00:00:00.000Z' })];
    const { cards } = lotCards(lots, [], [], sizes, DEFAULT_SETTINGS);
    expect(cards.map((c) => [c.lot.id, c.missing])).toEqual([
      ['B', 'Quantity missing: add the kg delivered on the Lots page (click the lot).'],
      ['A', 'Price missing: click "Add price" below.'],
    ]);
    expect(cards[0]?.bags).toEqual([]);
  });

  it('counts a roast split over two lots in both, with its part', () => {
    const older = lot('OLD', { quantity_kg: '1', delivery_date: '2026-08-01' });
    const newer = lot('NEW');
    const shares = sharesByLot([older, newer], [roast('R1', '1500', '1200')]);
    expect(shares.get('OLD')).toEqual([{ partGrams: 1000, greenGrams: 1500, roastedDecigrams: 12000 }]);
    expect(shares.get('NEW')).toEqual([{ partGrams: 500, greenGrams: 1500, roastedDecigrams: 12000 }]);
  });
});

describe('pricingFor (for the Products page)', () => {
  it('gives each active lot as a bean (newest first, green price per kg and roast loss), the packaging per size and the discounts', () => {
    const data = { settings: [], costs: [cost('250', 'Bag', '1.2'), cost('250', 'Label', '0.3')], lotCosts: [], discounts: [], problems: [] };
    const lots = [lot('OLD', { delivery_date: '2026-03-01' }), lot('NOPRICE', { coffee_price_net_pln: '' }), lot('GONE', { deleted_at: '2026-11-01T00:00:00.000Z' })];
    const result = pricingFor(data, lots, []);
    expect(result.settings).toEqual(DEFAULT_SETTINGS);
    // (4500 + 120) zł ÷ 60 kg = 77,00 zł per kg; usual loss 15 %
    expect(result.lots.map((l) => [l.lotId, l.label, l.greenPerKg, l.lossTenths])).toEqual([
      ['NOPRICE', 'KENYA-NOPRICE · Kegwa', null, 150],
      ['OLD', 'KENYA-OLD · Kegwa', 7700, 150],
    ]);
    expect([...result.packaging]).toEqual([
      [250, 150],
      [500, null],
      [1000, null],
    ]);
    expect(result.discounts.map((d) => [d.tenths, d.name])).toEqual([
      [150, 'Do 10 kg'],
      [250, '10–20 kg'],
      [300, '20+ kg'],
    ]);
  });
});

describe('lotLosses (for the Lots page)', () => {
  it("gives each lot's roast loss, where it comes from, and the owner's own value", () => {
    const own = lotCostFromFields({ id: 'O', lot_id: 'B', roast_loss_percent: '14.2' }, 2);
    const data = { settings: [], costs: [], lotCosts: [own], discounts: [], problems: [] };
    const roasts = [roast('R1', '1000', '850', { roastime_bean_id: 'BA' }), roast('R2', '1000', '830', { roastime_bean_id: 'BA' })];
    const { losses, problems } = lotLosses(data, [lot('A', { roastime_bean_id: 'BA' }), lot('B', { roastime_bean_id: 'BB' }), lot('C', { roastime_bean_id: 'BC' })], roasts);
    expect(problems).toEqual([]);
    expect(losses.get('A')).toEqual({ lossTenths: 160, source: 'average of 2 roasts', own: '' });
    expect(losses.get('B')).toEqual({ lossTenths: 142, source: 'your own', own: '14.2' });
    expect(losses.get('C')).toEqual({ lossTenths: 150, source: 'usual loss: no roasts with both weights yet', own: '' });
  });

  it('reports a saved loss it cannot read, so the owner can correct it on the Lots page', () => {
    const odd = lotCostFromFields({ id: 'O', lot_id: 'A', roast_loss_percent: 'a lot' }, 2);
    const { problems } = lotLosses({ settings: [], costs: [], lotCosts: [odd], discounts: [], problems: [] }, [lot('A')], []);
    expect(problems).toEqual(['The roast loss "a lot" saved for KENYA-A cannot be read; the average of its roasts is used instead.']);
  });
});
