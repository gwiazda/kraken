import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  bagCostFromFields,
  formFromBagCost,
  formFromSettings,
  formatMarkup,
  formatPercent,
  lotCostFromFields,
  parseDiscounts,
  parseMarkups,
  parsePercent,
  percentFromCell,
  readSettings,
  settingFromFields,
  validateBagCostForm,
  validateLoss,
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
  });
});

describe('settings', () => {
  it('uses the defaults agreed with the owner when nothing is saved', () => {
    expect(readSettings([])).toEqual({ settings: { vatTenths: 230, markupHundredths: [200, 250, 300], defaultLossTenths: 150, discountTenths: [150, 250, 300] }, problems: [] });
  });

  it('uses saved values, ignoring deleted rows', () => {
    const rows = [setting('vat_percent', '8'), setting('markups', '2;3', 3), setting('default_roast_loss_percent', '16.5', 4), setting('wholesale_discounts_percent', '10;20', 6), setting('vat_percent', '5', 5, '2026-11-16T10:00:00.000Z')];
    expect(readSettings(rows).settings).toEqual({ vatTenths: 80, markupHundredths: [200, 300], defaultLossTenths: 165, discountTenths: [100, 200] });
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
    expect(formFromSettings({ vatTenths: 230, markupHundredths: [200, 250], defaultLossTenths: 155, discountTenths: [150, 125] })).toEqual({
      vat: '23',
      markups: '2; 2,5',
      defaultLoss: '15,5',
      discounts: '15; 12,5',
    });
    expect(validateSettingsForm({ vat: '23', markups: '2; 2,5; 3', defaultLoss: '15,5', discounts: '15; 25; 30; 12,5' })).toEqual({
      ok: true,
      values: { vat_percent: '23', markups: '2;2.5;3', default_roast_loss_percent: '15.5', wholesale_discounts_percent: '15;25;30;12.5' },
    });
  });

  it('explains what is wrong in the settings form', () => {
    expect(validateSettingsForm({ vat: '', markups: 'x', defaultLoss: '120', discounts: '15, 25' })).toEqual({
      ok: false,
      errors: {
        vat: 'Enter the VAT rate, e.g. 23.',
        markups: 'Enter 1 to 5 multipliers separated by ";", e.g. 2; 2,5; 3.',
        defaultLoss: 'Enter a percentage from 1 to 99, e.g. 15.',
        discounts: 'Enter 1 to 10 percentages from 1 to 99 separated by ";", e.g. 15; 25; 30.',
      },
    });
  });
});

describe('wholesale discounts', () => {
  it('reads 1 to 10 percentages separated by ";"', () => {
    expect(parseDiscounts('15; 25; 30')).toEqual([150, 250, 300]);
    expect(parseDiscounts('12,5;40')).toEqual([125, 400]);
    expect(parseDiscounts(' 15 ; ')).toEqual([150]);
    expect(parseDiscounts('15; 25; 15')).toEqual([150, 250]);
  });

  it('refuses commas between them, 0 %, under 1 % (a "15%" cell arrives as 0.15), 100 % or more, and too many', () => {
    for (const bad of ['', '15, 25', '0', '0.15', '100', 'a lot', '1;2;3;4;5;6;7;8;9;10;11']) expect(parseDiscounts(bad)).toBeUndefined();
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
