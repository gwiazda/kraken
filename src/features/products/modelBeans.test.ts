import { describe, expect, it } from 'vitest';
import { beanChanges, beanFromFields, beansOf, formFromBean, typedBeanLoss, typedBeanPrice, validateBeans, type BeanForm } from './modelBeans';

const bean = (row: number, o: Record<string, string> = {}) =>
  beanFromFields({ id: `B${row}`, product_id: 'P1', position: String(row - 1), lot_id: 'L1', planned_name: '', planned_price_per_kg_pln: '', planned_roast_loss_percent: '', share_percent: '60', ...o }, row);
const lotBean = (lotId: string, share: number): BeanForm => ({ kind: 'lot', lotId, plannedName: '', plannedPrice: '', plannedLoss: '', sharePercent: share });
const planned = (o: Partial<BeanForm> = {}): BeanForm => ({ kind: 'planned', lotId: '', plannedName: 'Etiopia offer', plannedPrice: '52,50', plannedLoss: '', sharePercent: 40, ...o });

describe('reading beans', () => {
  it('reads a lot bean and a planned bean, and lists a product\'s active beans in order', () => {
    const a = bean(3, { position: '2', lot_id: '', planned_name: 'Etiopia offer', planned_price_per_kg_pln: '52.5', planned_roast_loss_percent: '16', share_percent: '40' });
    const b = bean(2, { position: '1' });
    const gone = bean(4, { position: '3', deleted_at: '2026-11-18T10:00:00.000Z' });
    const other = bean(5, { product_id: 'P2' });
    expect(beansOf([a, b, gone, other], 'P1').map((x) => x.id)).toEqual(['B2', 'B3']);
    expect(a).toMatchObject({ plannedPriceGrosze: 5250, plannedLossTenths: 160, sharePercent: 40 });
    expect(formFromBean(a)).toEqual({ kind: 'planned', lotId: '', plannedName: 'Etiopia offer', plannedPrice: '52,50', plannedLoss: '16', sharePercent: 40 });
    expect(formFromBean(b)).toMatchObject({ kind: 'lot', lotId: 'L1', sharePercent: 60 });
  });

  it('treats a "15%" cell (0.15) and other nonsense as unreadable', () => {
    expect(bean(2, { planned_roast_loss_percent: '0.15', share_percent: '0', planned_price_per_kg_pln: 'x' })).toMatchObject({ plannedLossTenths: null, sharePercent: null, plannedPriceGrosze: null });
  });
});

describe('typing a planned bean', () => {
  it('reads the price and the loss while typing', () => {
    expect(typedBeanPrice('52,50')).toBe(5250);
    expect(typedBeanPrice('')).toBeNull();
    expect(typedBeanLoss('')).toBeNull();
    expect(typedBeanLoss('16,5')).toBe(165);
    expect(typedBeanLoss('0')).toBeNull(); // 0 % is no real roast loss
    expect(validateBeans([planned({ plannedLoss: '0', sharePercent: 100 })])).toMatchObject({ ok: false, errors: [{ plannedLoss: 'Enter a percentage from 1 to 99, e.g. 16, or leave it empty.' }] });
  });
});

describe('validateBeans', () => {
  it('stores a lot bean and a planned bean with their positions', () => {
    expect(validateBeans([lotBean('L1', 60), planned()])).toEqual({
      ok: true,
      fields: [
        { position: '1', share_percent: '60', lot_id: 'L1', planned_name: '', planned_price_per_kg_pln: '', planned_roast_loss_percent: '' },
        { position: '2', share_percent: '40', lot_id: '', planned_name: 'Etiopia offer', planned_price_per_kg_pln: '52.5', planned_roast_loss_percent: '' },
      ],
    });
    expect(validateBeans([])).toEqual({ ok: true, fields: [] }); // a product without beans is fine
  });

  it('asks for a lot, a name and a price, and refuses the same lot twice', () => {
    const result = validateBeans([lotBean('', 30), planned({ plannedName: ' ', plannedPrice: 'cheap', plannedLoss: '0.15', sharePercent: 30 }), lotBean('L1', 40)]);
    expect(result).toEqual({
      ok: false,
      shares: '',
      errors: [
        { lotId: 'Choose a lot.' },
        { plannedName: 'Give it a name, e.g. Etiopia offer.', plannedPrice: 'Enter the price per kg in zł, with delivery and without VAT, e.g. 52,50.', plannedLoss: 'Enter a percentage from 1 to 99, e.g. 16, or leave it empty.' },
        {},
      ],
    });
    expect(validateBeans([lotBean('L1', 50), lotBean('L1', 50)])).toMatchObject({ ok: false, errors: [{}, { lotId: 'This lot is already in the product.' }] });
  });

  it('needs shares that add up to 100 %, and at most 3 beans', () => {
    expect(validateBeans([lotBean('L1', 60), lotBean('L2', 30)])).toMatchObject({ ok: false, shares: 'The shares must add up to 100 %, each at least 1 %.' });
    expect(validateBeans([lotBean('L1', 100), lotBean('L2', 0)])).toMatchObject({ ok: false, shares: 'The shares must add up to 100 %, each at least 1 %.' });
    expect(validateBeans([lotBean('A', 25), lotBean('B', 25), lotBean('C', 25), lotBean('D', 25)])).toMatchObject({ ok: false, shares: 'A product can be made of at most 3 beans.' });
  });
});

describe('beanChanges', () => {
  it('updates what changed by position, adds new beans and soft-deletes the rest', () => {
    const first = bean(2, { position: '1', share_percent: '60' });
    const second = bean(3, { position: '2', lot_id: 'L2', share_percent: '40' });
    const wanted = [
      { position: '1', share_percent: '70', lot_id: 'L1', planned_name: '', planned_price_per_kg_pln: '', planned_roast_loss_percent: '' },
    ];
    expect(beanChanges([first, second], wanted)).toEqual({ updates: [{ bean: first, changes: { share_percent: '70' } }], adds: [], removes: [second] });
    expect(beanChanges([], wanted)).toEqual({ updates: [], adds: wanted, removes: [] });
  });
});
