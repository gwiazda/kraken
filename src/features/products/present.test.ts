import { describe, expect, it } from 'vitest';
import { productFromFields } from './model';
import { compareRows, costing, discountHeader, priceRows, productDetails } from './present';
import type { BeanForm } from './modelBeans';

const kenia = productFromFields(
  { id: 'K', name: 'Kenia', country: 'Kenia', region: 'Kirinyaga', flavour_profile: 'Jagoda', brew_method: 'Filtr', price_250_gross_pln: '59', price_1000_gross_pln: '221' },
  2,
);

describe('priceRows', () => {
  it('shows the main gross price with its net, and the wholesale net (whole złoty) with its gross, per size', () => {
    const rows = priceRows(kenia.prices, [150, 250, 300], 230);
    expect(rows.map((r) => r.size)).toEqual(['250 g', '500 g', '1 kg']);
    expect(rows[0]).toEqual({
      size: '250 g',
      retail: { main: '59 zł', other: '47,97 zł netto', earn: '', margin: '', losing: false, marginLosing: false },
      wholesale: [
        { main: '41 zł', other: '50,43 zł brutto', earn: '', margin: '', losing: false, marginLosing: false },
        { main: '36 zł', other: '44,28 zł brutto', earn: '', margin: '', losing: false, marginLosing: false },
        { main: '34 zł', other: '41,82 zł brutto', earn: '', margin: '', losing: false, marginLosing: false },
      ],
    });
    // The same numbers as the owner's offer template (Kenia 1 kg: 153 / 135 / 126 zł).
    expect(rows[2]?.wholesale.map((c) => c.main)).toEqual(['153 zł', '135 zł', '126 zł']);
  });

  it('shows a dash where the product has no price for a size', () => {
    expect(priceRows(kenia.prices, [150], 230)[1]).toEqual({ size: '500 g', retail: { main: '—', other: '', earn: '', margin: '', losing: false, marginLosing: false }, wholesale: [{ main: '—', other: '', earn: '', margin: '', losing: false, marginLosing: false }] });
  });

  it('says what each price earns when the cost of a bag is known (wholesale prices are already without VAT)', () => {
    // A 250 g bag costs 24,15 zł: retail 59 zł is 47,97 zł without VAT, earns 23,82 zł; at −30 % 34 zł earns 9,85 zł.
    const [small] = priceRows(kenia.prices, [150, 300], 230, { 250: 2415 });
    expect([small?.retail.earn, ...(small?.wholesale.map((c) => c.earn) ?? [])]).toEqual(['zarabiasz 23,82\u00a0zł', 'zarabiasz 16,85\u00a0zł', 'zarabiasz 9,85\u00a0zł']);
    const [cheap] = priceRows({ 250: 3000 }, [300], 230, { 250: 2415 });
    // 30 zł − 30 % = 17,07 zł → 17 zł without VAT, less than the 24,15 zł the bag costs
    expect(cheap?.wholesale[0]).toMatchObject({ main: '17\u00a0zł', earn: 'strata 7,15\u00a0zł', losing: true });
    // Rounded like "You lose … per bag": 123 zł is 100 zł without VAT; a cost of 102,505 zł loses 2,51 zł, not 2,50 zł.
    const [half] = priceRows({ 250: 12300 }, [], 230, { 250: 10250.5 });
    expect(half?.retail).toMatchObject({ earn: 'strata 2,51\u00a0zł', losing: true });
  });

  it('gives the gross margin next to what each price earns: the part of the price without VAT that stays with you', () => {
    // 23,82 zł of 47,97 zł is 49,7 % → 50 %; 16,85 of 41 zł is 41,1 % → 41 %; 9,85 of 34 zł is 29,0 % → 29 %
    const [small] = priceRows(kenia.prices, [150, 300], 230, { 250: 2415 });
    expect([small?.retail.margin, ...(small?.wholesale.map((c) => c.margin) ?? [])]).toEqual(['marża 50\u00a0%', 'marża 41\u00a0%', 'marża 29\u00a0%']);
    // a loss: 7,15 zł short of 17 zł is −42 %
    expect(priceRows({ 250: 3000 }, [300], 230, { 250: 2415 })[0]?.wholesale[0]).toMatchObject({ margin: 'marża −42\u00a0%', marginLosing: true });
    // a loss of 0,10 zł on 47,97 zł is −0,2 %, shown as "0 %": the earnings are red, the margin is not
    expect(priceRows({ 250: 5900 }, [], 230, { 250: 4807 })[0]?.retail).toMatchObject({ earn: 'strata 0,10\u00a0zł', losing: true, margin: 'marża 0\u00a0%', marginLosing: false });
  });

  it('writes the discount headers the Polish way', () => {
    expect([150, 125].map(discountHeader)).toEqual(['−15 %', '−12,5 %']);
  });
});

describe('productDetails', () => {
  it('lists only the details that are filled in', () => {
    expect(productDetails(kenia)).toEqual([
      { label: 'Kraj', value: 'Kenia' },
      { label: 'Region', value: 'Kirinyaga' },
      { label: 'Profil smakowy', value: 'Jagoda' },
    ]);
  });
});

describe('costing (what a bag costs and earns)', () => {
  const lots = [
    { lotId: 'KEN', label: 'KENYA-26-09 · Kegwa', greenPerKg: 7700, lossTenths: 150, lossSource: 'average of 23 roasts' },
    { lotId: 'NOPRICE', label: 'PERU-26-10 · Cajamarca', greenPerKg: null, lossTenths: 150, lossSource: '' },
  ];
  const packaging = new Map([
    [250, 150],
    [500, null],
    [1000, 250],
  ]);
  const lotBean = (lotId: string, share: number): BeanForm => ({ kind: 'lot', lotId, plannedName: '', plannedPrice: '', plannedLoss: '', sharePercent: share });

  it('works out the hand-checked example for one bean: 24,15 zł a bag, suggestions 59 / 74 / 89 zł and their earnings', () => {
    const result = costing([lotBean('KEN', 100)], lots, packaging, 230, 150, { 250: 5900 });
    expect(result.madeOf).toBe('Skład: 100 % KENYA-26-09 · Kegwa');
    expect(result.perKg).toBe('90,59\u00a0zł za kg palonej kawy');
    expect(result.perKgPrice).toBe('90,59\u00a0zł za kg'); // the title "Skąd 90,59 zł za kg?"
    expect(result.rows[0]).toMatchObject({
      size: '250 g',
      cost: '24,15\u00a0zł',
      parts: 'kawa 22,65\u00a0zł i opakowanie 1,50\u00a0zł',
      earnings: '23,82\u00a0zł',
      margin: '50\u00a0%', // 23,82 of 47,97 zł
      losing: false,
    });
    // 74 zł is 60,16 zł without VAT: 36,02 of it is 59,9 % → 60 %; 89 zł is 72,36 zł: 48,21 of it is 66,6 % → 67 %
    expect(result.rows[0]?.suggestions.map((s) => [s.text, s.markup, s.earnings, s.margin])).toEqual([
      ['59\u00a0zł', '2×', '23,82\u00a0zł', '50\u00a0%'],
      ['74\u00a0zł', '2,5×', '36,02\u00a0zł', '60\u00a0%'],
      ['89\u00a0zł', '3×', '48,21\u00a0zł', '67\u00a0%'],
    ]);
    expect(result.rows[1]).toMatchObject({ cost: '', parts: 'kawa 45,29\u00a0zł, opakowanie niewpisane' });
    // Explained step by step, in plain sentences with the numbers.
    expect(result.perKgSteps).toEqual([
      'KENYA-26-09 · Kegwa: zielona kawa kosztuje 77,00\u00a0zł za kg. Palenie zabiera 15 % wagi (average of 23 roasts), więc 1 kg palonej kawy kosztuje 90,59\u00a0zł.',
    ]);
    expect(result.rows[0]?.steps).toEqual([
      'Kawa: 250 g palonej kawy po 90,59\u00a0zł za kg kosztuje 22,65\u00a0zł.',
      'Opakowanie: 1,50\u00a0zł (torebka, etykieta i reszta, z zakładki Opakowania i rabaty).',
      'Czyli jedna torebka kosztuje Cię 24,15\u00a0zł netto.',
      'Twoja cena 59\u00a0zł zawiera 23 % VAT; netto to 47,97\u00a0zł. Odejmij 24,15\u00a0zł, ile kosztuje torebka: zarabiasz 23,82\u00a0zł na torebce.',
      'Marża brutto 50\u00a0%: to część z 47,97\u00a0zł netto, która zostaje Tobie (23,82\u00a0zł).',
      'Dwa razy koszt to 48,29\u00a0zł; z VAT 59,40\u00a0zł, po zaokrągleniu 59\u00a0zł. Przy tej cenie zarabiasz 23,82\u00a0zł na torebce, marża brutto 50\u00a0%.',
      'Dwa i pół raza koszt to 60,37\u00a0zł; z VAT 74,25\u00a0zł, po zaokrągleniu 74\u00a0zł. Przy tej cenie zarabiasz 36,02\u00a0zł na torebce, marża brutto 60\u00a0%.',
      'Trzy razy koszt to 72,44\u00a0zł; z VAT 89,10\u00a0zł, po zaokrągleniu 89\u00a0zł. Przy tej cenie zarabiasz 48,21\u00a0zł na torebce, marża brutto 67\u00a0%.',
    ]);
    // 1 kg follows the 250 g price: 4 × 59 zł − 4 small packagings (1,845 zł with VAT) + one 1 kg packaging (3,075 zł) = 231,695 zł
    // 232 zł is 188,62 zł without VAT: 95,53 of it is 50,6 % → 51 %
    expect(result.rows[2]?.suggestions.map((x) => [x.text, x.markup, x.earnings, x.margin])).toEqual([['232\u00a0zł', 'jak 4 × 250 g', '95,53\u00a0zł', '51\u00a0%']]);
    expect(result.rows[2]?.steps[3]).toBe(
      'Proponowana cena, od Twojej ceny za 250 g: cztery torebki 250 g po 59\u00a0zł to 236,00\u00a0zł. Odejmij opakowania tych małych torebek (7,38\u00a0zł z VAT) i dodaj opakowanie jednej torebki 1 kg (3,08\u00a0zł z VAT): 231,70\u00a0zł, po zaokrągleniu 232\u00a0zł. Przy tej cenie zarabiasz 95,53\u00a0zł na torebce, marża brutto 51\u00a0%.',
    );
    const noBase = costing([lotBean('KEN', 100)], lots, packaging, 230, 150, {});
    expect(noBase.rows[2]?.suggestions).toEqual([]);
    expect(noBase.rows[2]?.steps[3]).toBe('Najpierw ustaw cenę za 250 g: proponowana cena za 1 kg jest liczona od niej.');
    expect(result.rows[1]?.steps).toEqual([
      'Kawa: 500 g palonej kawy po 90,59\u00a0zł za kg kosztuje 45,29\u00a0zł.',
      'Opakowanie dla 500 g nie jest jeszcze wpisane: dodaj je w zakładce Opakowania i rabaty, aby zobaczyć pełny koszt.',
    ]);
    expect(result.notes).toEqual(['Nie wpisano opakowania dla 500 g: dodaj je w zakładce Opakowania i rabaty.']);
  });

  it('blends a lot with a planned bean (usual loss when none is typed)', () => {
    const plannedBean: BeanForm = { kind: 'planned', lotId: '', plannedName: 'Etiopia offer', plannedPrice: '50', plannedLoss: '20', sharePercent: 40 };
    const result = costing([lotBean('KEN', 60), plannedBean], lots, packaging, 230, 150, {});
    expect(result.madeOf).toBe('Skład: 60 % KENYA-26-09 · Kegwa i 40 % Etiopia offer (planowane)');
    expect(result.perKg).toBe('79,35\u00a0zł za kg palonej kawy');
    expect(result.perKgSteps).toEqual([
      'KENYA-26-09 · Kegwa: zielona kawa kosztuje 77,00\u00a0zł za kg. Palenie zabiera 15 % wagi (average of 23 roasts), więc 1 kg palonej kawy kosztuje 90,59\u00a0zł.',
      'Etiopia offer: zielona kawa kosztuje 50,00\u00a0zł za kg. Palenie zabiera 20 % wagi (Twoja liczba), więc 1 kg palonej kawy kosztuje 62,50\u00a0zł.',
      'W torebce: 60 % z 90,59\u00a0zł i 40 % z 62,50\u00a0zł, co daje 79,35\u00a0zł za kg palonej kawy.',
    ]);
    const usual = costing([{ ...plannedBean, plannedLoss: '', sharePercent: 100 }], lots, packaging, 230, 150, {});
    expect(usual.perKg).toBe('58,82\u00a0zł za kg palonej kawy'); // 50 zł ÷ 0,85
  });

  it('shows a loss when the price does not cover the cost', () => {
    const result = costing([lotBean('KEN', 100)], lots, packaging, 230, 150, { 250: 2000 });
    // 7,89 zł short of 16,26 zł is −48,5 % → −49 %
    expect(result.rows[0]).toMatchObject({ earnings: '−7,89\u00a0zł', margin: '−49\u00a0%', losing: true, marginLosing: true });
    expect(result.rows[0]?.steps[3]).toBe('Twoja cena 20\u00a0zł zawiera 23 % VAT; netto to 16,26\u00a0zł. Odejmij 24,15\u00a0zł, ile kosztuje torebka: tracisz 7,89\u00a0zł na torebce.');
    expect(result.rows[0]?.steps[4]).toBe('Marża brutto −49\u00a0%: cena netto nie pokrywa kosztu torebki.');
  });

  it('says in plain words what is missing', () => {
    expect(costing([lotBean('NOPRICE', 100)], lots, packaging, 230, 150, {}).notes).toEqual(['PERU-26-10 · Cajamarca nie ma jeszcze ceny: dodaj ją w zakładce Zielone ziarno (kliknij dostawę).']);
    expect(costing([lotBean('', 100)], lots, packaging, 230, 150, {}).notes).toEqual(['Wybierz dostawę dla każdego ziarna.']);
    expect(costing([lotBean('KEN', 60), lotBean('', 30)], lots, packaging, 230, 150, {}).notes).toEqual(['Wybierz dostawę dla każdego ziarna.', 'Udziały dają razem 90 %, a nie 100 %.']);
    expect(costing([], lots, packaging, 230, 150, {})).toEqual({ madeOf: '', perKg: '', perKgPrice: '', rows: expect.any(Array) as unknown, notes: [], perKgSteps: [] });
  });

  it('names the missing 250 g packaging when the bigger sizes cannot follow the 250 g price', () => {
    const noSmall = new Map([
      [250, null],
      [500, 200],
      [1000, 250],
    ]);
    const result = costing([lotBean('KEN', 100)], lots, noSmall, 230, 150, { 250: 5900 });
    expect(result.rows[2]?.suggestions).toEqual([]);
    expect(result.rows[2]?.steps[3]).toBe('Dodaj opakowanie dla 250 g w zakładce Opakowania i rabaty: proponowana cena za 1 kg jest liczona od torebki 250 g.');
  });

  it('never says "You lose 0,00 zł" for a loss of less than a grosz', () => {
    // The bag costs 24,147059 zł; 29,70 zł with VAT is 24,146341 zł without: 0,07 grosz short, shown as 0,00 zł.
    const result = costing([lotBean('KEN', 100)], lots, packaging, 230, 150, { 250: 2970 });
    expect(result.rows[0]).toMatchObject({ earnings: '0,00\u00a0zł', margin: '0\u00a0%', losing: false, marginLosing: false });
    // the explanation agrees with the row: no "lose 0,00 zł", no "does not cover"
    expect(result.rows[0]?.steps.slice(3, 5)).toEqual([
      'Twoja cena 29,70\u00a0zł zawiera 23 % VAT; netto to 24,15\u00a0zł. Odejmij 24,15\u00a0zł, ile kosztuje torebka: zarabiasz 0,00\u00a0zł na torebce.',
      'Marża brutto 0\u00a0%: to część z 24,15\u00a0zł netto, która zostaje Tobie (0,00\u00a0zł).',
    ]);
  });
});

describe('compareRows (the plan next to the products)', () => {
  const lots = [{ lotId: 'KEN', label: 'KENYA-26-09 · Kegwa', greenPerKg: 7700, lossTenths: 150, lossSource: '' }];
  const packaging = new Map([
    [250, 150],
    [500, null],
    [1000, 250],
  ]);
  const kenBean = (share: number): BeanForm => ({ kind: 'lot', lotId: 'KEN', plannedName: '', plannedPrice: '', plannedLoss: '', sharePercent: share });
  const planned: BeanForm = { kind: 'planned', lotId: '', plannedName: 'Cheap offer', plannedPrice: '30', plannedLoss: '', sharePercent: 100 };

  it('puts the plan among the products, sorted by what they earn, with what they earn at the biggest discount', () => {
    const rows = compareRows(
      [
        { name: 'Kenia', isPlan: false, beans: [kenBean(100)], prices: { 250: 5900 } },
        { name: 'This plan', isPlan: true, beans: [planned], prices: { 250: 5900 } },
        { name: 'Burundi', isPlan: false, beans: [], prices: { 250: 6500 } },
      ],
      250,
      lots,
      packaging,
      230,
      150,
      [150, 300],
    );
    // At each discount: the price after it (net, whole złoty) and what a bag earns at it.
    expect(rows[0]?.atDiscounts).toEqual([
      // 30,68 of 41 zł is 74,8 % → 75 %; 23,68 of 34 zł is 69,6 % → 70 %
      { price: '41\u00a0zł', earn: 'zarabiasz 30,68\u00a0zł', margin: 'marża 75\u00a0%', losing: false, marginLosing: false },
      { price: '34\u00a0zł', earn: 'zarabiasz 23,68\u00a0zł', margin: 'marża 70\u00a0%', losing: false, marginLosing: false },
    ]);
    expect(rows[2]?.atDiscounts).toEqual([
      { price: '45\u00a0zł', earn: '', margin: '', losing: false, marginLosing: false }, // Burundi: 65 zł → 45 zł at −15 % (as on the template); no beans, so no earnings
      { price: '37\u00a0zł', earn: '', margin: '', losing: false, marginLosing: false },
    ]);
    // The retail margin: the plan earns 37,64 of 47,97 zł (78,5 % → 78 %); Kenia 23,82 of 47,97 zł → 50 %
    expect(rows.slice(0, 2).map((r) => [r.margin, r.marginLosing])).toEqual([
      ['marża 78\u00a0%', false],
      ['marża 50\u00a0%', false],
    ]);
    expect(rows.map((r) => [r.name, r.isPlan, r.cost, r.price, r.earn, r.atDiscounts.map((a) => a.earn).join(' / '), r.note])).toEqual([
      // 30 zł per kg green ÷ 0,85 = 35,29 zł per kg roasted; 250 g = 8,82 zł + 1,50 zł packaging = 10,32 zł;
      // 59 zł is 47,97 zł without VAT → earns 37,64 zł; at −30 % it is 34 zł → earns 23,68 zł
      ['This plan', true, '10,32\u00a0zł', '59\u00a0zł', 'zarabiasz 37,64\u00a0zł', 'zarabiasz 30,68\u00a0zł / zarabiasz 23,68\u00a0zł', ''],
      ['Kenia', false, '24,15\u00a0zł', '59\u00a0zł', 'zarabiasz 23,82\u00a0zł', 'zarabiasz 16,85\u00a0zł / zarabiasz 9,85\u00a0zł', ''],
      ['Burundi', false, '', '65\u00a0zł', '', ' / ', 'nie wybrano ziaren'],
    ]);
  });

  it('says why a row cannot be worked out, and shows a loss in red', () => {
    const rows = compareRows(
      [
        { name: 'No price', isPlan: true, beans: [kenBean(100)], prices: {} },
        { name: 'Too cheap', isPlan: false, beans: [kenBean(100)], prices: { 250: 3000 } },
      ],
      250,
      lots,
      new Map([[250, 150]]),
      230,
      150,
      [300],
    );
    expect(rows.map((r) => [r.name, r.atDiscounts[0]?.earn, r.atDiscounts[0]?.losing, r.note])).toEqual([
      ['Too cheap', 'strata 7,15\u00a0zł', true, ''],
      ['No price', '', false, 'brak ceny za 250 g'],
    ]);
    // No packaging for 250 g: the cost cannot be worked out (and both reasons when the price is missing too).
    const noPackaging = new Map([[250, null]]);
    expect(compareRows([{ name: 'X', isPlan: false, beans: [kenBean(100)], prices: { 250: 5900 } }], 250, lots, noPackaging, 230, 150, [300])[0]?.note).toBe('koszt jeszcze nieznany');
    expect(compareRows([{ name: 'X', isPlan: false, beans: [kenBean(100)], prices: {} }], 250, lots, noPackaging, 230, 150, [300])[0]?.note).toBe('koszt jeszcze nieznany, brak ceny za 250 g');
    expect(compareRows([{ name: 'X', isPlan: false, beans: [kenBean(100)], prices: { 500: 9000 } }], 500, lots, new Map([[500, null]]), 230, 150, [])[0]?.note).toBe('koszt jeszcze nieznany');
  });
});

