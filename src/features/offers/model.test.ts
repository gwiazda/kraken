import { describe, expect, it } from 'vitest';
import { formatDate } from '../../core/dates';
import { addDays, bannerText, cleanName, discountText, offerFileName, sizesText, tierText, validateOffer } from './model';

describe('dates and the file name', () => {
  it('adds the two weeks across months and years', () => {
    expect(addDays('2026-11-16', 14)).toBe('2026-11-30');
    expect(addDays('2026-12-25', 14)).toBe('2027-01-08');
    expect(addDays('2028-02-20', 14)).toBe('2028-03-05'); // leap year
  });

  it('writes dates the Polish way and names the file after the customer and date', () => {
    expect(formatDate('2026-11-16')).toBe('16.11.2026');
    expect(offerFileName('Kawiarnia Pod Lipą', '2026-11-16')).toBe('Oferta dla Kawiarnia Pod Lipą 16.11.2026');
  });

  it('removes from the name what a file name cannot have', () => {
    expect(cleanName('  Bar "Kawa/Herbata"  sp. z o.o.? ')).toBe('Bar Kawa Herbata sp. z o.o.');
    expect(cleanName('x'.repeat(100))).toHaveLength(80);
  });
});

describe('discounts and the banner', () => {
  it('writes discounts and tier lines as on the template', () => {
    expect(discountText(150)).toBe('-15%');
    expect(discountText(125)).toBe('-12,5%');
    expect(tierText({ tenths: 150, label: 'Do 10 kg' })).toBe('Do 10 kg (-15%):');
    expect(tierText({ tenths: 200, label: '' })).toBe('Rabat -20%:');
  });

  it('lists the sizes the Polish way', () => {
    expect(sizesText(['250 g'])).toBe('250 g');
    expect(sizesText(['250 g', '1 kg'])).toBe('250 g i 1 kg');
    expect(sizesText(['250 g', '500 g', '1 kg'])).toBe('250 g, 500 g i 1 kg');
  });

  it('builds the banner from the ticked discounts, lowest first', () => {
    const tiers = [
      { tenths: 300, label: '20+ kg' },
      { tenths: 150, label: 'Do 10 kg' },
      { tenths: 250, label: '10–20 kg' },
    ];
    expect(bannerText(tiers, ['250 g', '1 kg'])).toEqual({
      title: 'Ceny netto B2B:',
      line: 'Do 10 kg: -15% | 10–20 kg: -25% | 20+ kg: -30%',
      note: '* Wysokość rabatu zależy od łącznej wagi kawy na jednej fakturze. W ramach zamówienia można dowolnie łączyć rodzaje ziaren oraz gramatury 250 g i 1 kg.',
    });
    expect(bannerText([{ tenths: 200, label: '' }], ['250 g'])).toEqual({ title: 'Ceny netto B2B:', line: 'Rabat: -20%', note: '' });
  });
});

describe('validateOffer', () => {
  const ok = { customer: 'Kawiarnia', date: '2026-11-16', productIds: ['P1'], sizes: [250], tiers: [{ tenths: 150, label: 'Do 10 kg' }], banner: null };

  it('accepts a complete offer', () => {
    expect(validateOffer(ok)).toEqual({});
  });

  it('says what is missing', () => {
    expect(validateOffer({ customer: ' / ', date: '2026-02-30', productIds: [], sizes: [], tiers: [], banner: null })).toEqual({
      customer: 'Wpisz, dla kogo jest oferta.',
      date: 'Wybierz datę oferty.',
      products: 'Zaznacz co najmniej jeden produkt.',
      sizes: 'Zaznacz co najmniej jedną wielkość torebki.',
      tiers: 'Zaznacz co najmniej jeden rabat (ustawiasz je w zakładce Opakowania i rabaty).',
    });
    expect(validateOffer({ ...ok, tiers: [{ tenths: 150, label: 'x'.repeat(13) }] })).toEqual({ tiers: 'Nazwa „xxxxxxxxxxxxx” ma więcej niż 12 znaków, więc nie zmieści się przy cenach. Skróć ją w zakładce Opakowania i rabaty.' });
    expect(validateOffer({ ...ok, tiers: [{ tenths: 150, label: 'Powyżej 20kg' }] })).toEqual({});
    const five = [100, 150, 200, 250, 300].map((tenths) => ({ tenths, label: '' }));
    expect(validateOffer({ ...ok, tiers: five })).toEqual({ tiers: 'Zaznacz najwyżej 4 rabaty, żeby oferta była czytelna.' });
    expect(validateOffer({ ...ok, tiers: five.slice(0, 4) })).toEqual({});
    expect(validateOffer({ ...ok, banner: { title: '', line: 'x'.repeat(301), note: '' } })).toEqual({ banner: 'Każda część baneru może mieć najwyżej 300 znaków.' });
    expect(validateOffer({ ...ok, banner: { title: '', line: 'x'.repeat(300), note: '' } })).toEqual({});
  });

  it("needs no standard discount when a client's special prices are used (only their prices on the offer)", () => {
    expect(validateOffer({ ...ok, tiers: [] }, true)).toEqual({});
    expect(validateOffer({ ...ok, tiers: [] }, false)).toEqual({ tiers: 'Zaznacz co najmniej jeden rabat (ustawiasz je w zakładce Opakowania i rabaty).' });
  });

  it('refuses an offer where a ticked product size would have no price at all', () => {
    expect(validateOffer({ ...ok, tiers: [] }, true, ['KENIA 1 kg', 'PERU 250 g'])).toEqual({
      tiers: 'Brak ceny dla: KENIA 1 kg, PERU 250 g; nie ma dla nich ceny specjalnej, a żaden rabat nie jest zaznaczony. Zaznacz rabat albo odznacz ten produkt lub wielkość.',
    });
  });
});
