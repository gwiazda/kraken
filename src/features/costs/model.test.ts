import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  bagCostFromFields,
  formFromBagCost,
  formFromSettings,
  formatBagSize,
  formatMarkup,
  formatPercent,
  lotCostFromFields,
  parseMarkups,
  parsePercent,
  percentFromCell,
  readSettings,
  settingFromFields,
  validateBagCostForm,
  typedPricePerKg,
  validateLoss,
  validatePriceForm,
  validateSettingsForm,
} from './model';

const setting = (name: string, value: string, row = 2, deleted = '') => settingFromFields({ id: `S${row}`, name, value, deleted_at: deleted }, row);

describe('numbers typed by the owner', () => {
  it('reads percentages below 100 with one decimal', () => {
    expect(parsePercent('23')).toBe(230);
    expect(parsePercent('15,5')).toBe(155);
    expect(parsePercent(' 0 ')).toBe(0);
    expect(parsePercent('')).toBeNull();
    expect(parsePercent('100')).toBeUndefined();
    expect(parsePercent('15,55')).toBeUndefined();
    expect(parsePercent('-5')).toBeUndefined();
  });

  it('reads markups separated by ";"', () => {
    expect(parseMarkups('2; 2,5; 3')).toEqual([200, 250, 300]);
    expect(parseMarkups('2.2;')).toEqual([220]);
    expect(parseMarkups('')).toBeUndefined();
    expect(parseMarkups('2; 0')).toBeUndefined();
    expect(parseMarkups('2, 3')).toBeUndefined(); // a comma is a decimal comma, not a separator
    expect(parseMarkups('1;2;3;4;5;6')).toBeUndefined();
  });

  it('refuses 0 < x < 1 % from a cell or a form: "20%" typed in the sheet arrives as 0.2', () => {
    expect(percentFromCell('0.2')).toBeUndefined();
    expect(percentFromCell('0.15')).toBeUndefined();
    expect(percentFromCell('0')).toBe(0);
    expect(percentFromCell('1')).toBe(10);
    expect(percentFromCell('23')).toBe(230);
    expect(readSettings([setting('vat_percent', '0.23')]).problems).toHaveLength(1);
    expect(lotCostFromFields({ lot_id: 'L1', roast_loss_percent: '0.15' }, 2)).toMatchObject({ lossTenths: null, lossText: '0.15' });
    expect(validateLoss('0,5').ok).toBe(false);
  });

  it('formats for the screen', () => {
    expect(formatPercent(155)).toBe('15,5 %');
    expect(formatPercent(230)).toBe('23 %');
    expect(formatMarkup(250)).toBe('2,5×');
    expect(formatBagSize(250)).toBe('250 g');
    expect(formatBagSize(1000)).toBe('1 kg');
    expect(formatBagSize(1500)).toBe('1,5 kg');
  });
});

describe('settings', () => {
  it('uses the defaults agreed with the owner when nothing is saved', () => {
    expect(readSettings([])).toEqual({ settings: { vatTenths: 230, markupHundredths: [200, 250, 300], defaultLossTenths: 150 }, problems: [] });
  });

  it('uses saved values, ignoring deleted rows', () => {
    const rows = [setting('vat_percent', '8'), setting('markups', '2;3', 3), setting('default_roast_loss_percent', '16.5', 4), setting('vat_percent', '5', 5, '2026-11-16T10:00:00.000Z')];
    expect(readSettings(rows).settings).toEqual({ vatTenths: 80, markupHundredths: [200, 300], defaultLossTenths: 165 });
  });

  it('reports a value it cannot read or a duplicate row, and uses the default or the first row', () => {
    const { settings, problems } = readSettings([setting('vat_percent', 'lots'), setting('markups', '2', 3), setting('markups', '4', 7)]);
    expect(settings).toEqual({ ...DEFAULT_SETTINGS, markupHundredths: [200] });
    expect(problems).toEqual([
      'The setting "vat_percent" has the value "lots", which Kraken cannot read; it uses the default instead.',
      'The Cost settings tab has 2 rows named "markups" (rows 3, 7); Kraken uses the first.',
    ]);
  });

  it('fills the form the Polish way and stores the values the same way every time', () => {
    expect(formFromSettings({ vatTenths: 230, markupHundredths: [200, 250], defaultLossTenths: 155 })).toEqual({ vat: '23', markups: '2; 2,5', defaultLoss: '15,5' });
    expect(validateSettingsForm({ vat: '23', markups: '2; 2,5; 3', defaultLoss: '15,5' })).toEqual({
      ok: true,
      values: { vat_percent: '23', markups: '2;2.5;3', default_roast_loss_percent: '15.5' },
    });
  });

  it('explains what is wrong in the settings form', () => {
    expect(validateSettingsForm({ vat: '', markups: 'x', defaultLoss: '120' })).toEqual({
      ok: false,
      errors: {
        vat: 'Enter the VAT rate, e.g. 23.',
        markups: 'Enter 1 to 5 markups separated by ";", e.g. 2; 2,5; 3.',
        defaultLoss: 'Enter a percentage from 1 to 99, e.g. 15.',
      },
    });
  });
});

describe('bag sizes and costs', () => {
  it('reads a cost item, keeping a cost it cannot read as typed', () => {
    expect(bagCostFromFields({ id: 'C1', bag_size_id: 'S1', item: 'Bag', cost_net_pln: '1.2' }, 2)).toMatchObject({ item: 'Bag', costGrosze: 120 });
    const odd = bagCostFromFields({ id: 'C2', bag_size_id: 'S1', item: 'Label', cost_net_pln: 'about 30 gr' }, 3);
    expect(odd.costGrosze).toBeNull();
    expect(formFromBagCost(odd)).toEqual({ item: 'Label', cost: 'about 30 gr' });
    expect(formFromBagCost(bagCostFromFields({ item: 'Bag', cost_net_pln: '1.2' }, 2))).toEqual({ item: 'Bag', cost: '1,20' });
  });

  it('checks a cost item', () => {
    expect(validateBagCostForm({ item: ' Valve ', cost: '0,35' })).toEqual({ ok: true, fields: { item: 'Valve', cost_net_pln: '0.35' } });
    expect(validateBagCostForm({ item: 'Stamp', cost: '0' })).toEqual({ ok: true, fields: { item: 'Stamp', cost_net_pln: '0' } });
    expect(validateBagCostForm({ item: '', cost: 'x' })).toEqual({
      ok: false,
      errors: { item: 'Enter what it is, e.g. Bag or Label.', cost: 'Enter the net cost per bag in zł, e.g. 0,85.' },
    });
    expect(validateBagCostForm({ item: 'Bag', cost: '1500' })).toEqual({ ok: false, errors: { cost: 'That is more than 1 000 zł per bag; please check.' } });
  });
});

describe('roast loss per lot', () => {
  it('reads the saved value; empty means "use the average"', () => {
    expect(lotCostFromFields({ id: 'X', lot_id: 'L1', roast_loss_percent: '14.2' }, 2).lossTenths).toBe(142);
    expect(lotCostFromFields({ id: 'X', lot_id: 'L1', roast_loss_percent: '' }, 2).lossTenths).toBeNull();
  });

  it('checks a typed loss', () => {
    expect(validateLoss('14,2')).toEqual({ ok: true, value: '14.2' });
    expect(validateLoss(' ')).toEqual({ ok: true, value: '' });
    expect(validateLoss('100').ok).toBe(false);
  });
});

describe("the lot's price, edited under Costs & prices", () => {
  const initial = { coffeePrice: '4500', deliveryCost: '120' };

  it('gives only the columns that changed', () => {
    expect(validatePriceForm({ coffeePrice: '4600,50', deliveryCost: '120' }, initial)).toEqual({ ok: true, fields: { coffee_price_net_pln: '4600.5' } });
    expect(validatePriceForm({ coffeePrice: '4500', deliveryCost: '' }, initial)).toEqual({ ok: true, fields: { delivery_cost_net_pln: '' } });
    expect(validatePriceForm(initial, initial)).toEqual({ ok: true, fields: {} });
  });

  it('never rewrites a cell it showed as typed (unreadable) when only the other one changed', () => {
    const odd = { coffeePrice: 'about 4500', deliveryCost: '120' };
    expect(validatePriceForm({ coffeePrice: 'about 4500', deliveryCost: '130' }, odd)).toEqual({
      ok: false,
      errors: { coffeePrice: 'Enter an amount, e.g. 4500 or 4500,50 — or leave it empty for now.' },
    });
  });

  it('explains wrong amounts', () => {
    expect(validatePriceForm({ coffeePrice: 'x', deliveryCost: '-5' }, initial)).toEqual({
      ok: false,
      errors: {
        coffeePrice: 'Enter an amount, e.g. 4500 or 4500,50 — or leave it empty for now.',
        deliveryCost: 'Enter an amount, e.g. 120 — or leave it empty if there was none.',
      },
    });
  });

  it('shows the green price per kg while typing, once price and kg are readable', () => {
    expect(typedPricePerKg({ coffeePrice: '4500', deliveryCost: '120' }, 60000)).toBe(7700);
    expect(typedPricePerKg({ coffeePrice: '4500', deliveryCost: '' }, 60000)).toBe(7500);
    expect(typedPricePerKg({ coffeePrice: '', deliveryCost: '120' }, 60000)).toBeNull();
    expect(typedPricePerKg({ coffeePrice: '4500', deliveryCost: 'abc' }, 60000)).toBeNull();
    expect(typedPricePerKg({ coffeePrice: '4500', deliveryCost: '' }, null)).toBeNull();
    expect(typedPricePerKg({ coffeePrice: '4500', deliveryCost: '' }, 0)).toBeNull();
  });
});
