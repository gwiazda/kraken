import { describe, expect, it } from 'vitest';
import {
  changedSaleFields,
  emptyLine,
  emptySaleForm,
  formFromSale,
  lineSizeProblems,
  lineFromFields,
  linesOf,
  saleFromFields,
  bagCount,
  sortSales,
  choosableIds,
  saleEditFields,
  startingInvoice,
  statusChange,
  needsInvoiceDate,
  suggestedInvoiceDate,
  validateSale,
  type SaleForm,
} from './model';

// Made-up sales only.
const sale = (row: number, o: Record<string, string> = {}) =>
  saleFromFields({ id: `S${row}`, date: '2026-11-19', kind: 'sale', client_id: 'C1', place: '', reason: '', invoice_status: 'to_issue', notes: '', ...o }, row);
const line = (row: number, o: Record<string, string> = {}) =>
  lineFromFields({ id: `L${row}`, sale_id: 'S2', position: '1', product_id: 'P1', bag_size_g: '1000', bags: '3', unit_price_net_pln: '97.02', free: '', ...o }, row);
const form = (o: Partial<SaleForm> = {}): SaleForm => ({
  ...emptySaleForm('2026-11-19'),
  clientId: 'C1',
  lines: [{ productId: 'P1', grams: '1000', bags: '3', free: false }],
  ...o,
});

describe('reading sales and lines', () => {
  it('reads a sale and its lines', () => {
    expect(sale(2)).toMatchObject({ kind: 'sale', clientId: 'C1', status: 'to_issue', problems: [] });
    expect(line(3)).toMatchObject({ grams: 1000, bags: 3, free: false });
    expect(line(4, { free: 'yes' })).toMatchObject({ free: true, problems: [] });
    expect(line(6, { bag_size_g: '150' })).toMatchObject({ grams: 150, problems: [] }); // a sample of 150 g
    expect(line(5, { bags: '2.5', bag_size_g: '0.5' }).problems).toEqual([
      'Wiersz 5 zakładki „Sale lines” ma gramaturę „0.5”, która nie jest wagą w gramach (od 1 do 5000).',
      'Wiersz 5 zakładki „Sale lines” ma liczbę torebek „2.5”, która nie jest liczbą całkowitą; nie jest liczona.',
    ]);
  });

  it('has no invoice status for a sample or own use', () => {
    expect(sale(2, { kind: 'sample', invoice_status: '' }).status).toBeNull();
    expect(sale(2, { kind: 'own_use', invoice_status: 'to_issue' }).status).toBeNull();
  });

  it('says which cells it cannot read', () => {
    expect(sale(5, { kind: 'gift', date: '19.11.2026' }).problems).toEqual([
      'Wiersz 5 zakładki „Sales” ma rodzaj „gift”, a powinien być sale, sample albo own_use.',
      'Wiersz 5 zakładki „Sales” ma datę „19.11.2026”, która nie jest datą (RRRR-MM-DD).',
    ]);
    expect(sale(6, { invoice_status: 'done' }).problems).toEqual(['Wiersz 6 zakładki „Sales” ma stan faktury „done”, którego Kraken nie umie odczytać.']);
  });

  it("lists a sale's active lines in order, and sales newest first", () => {
    const lines = [line(3, { position: '2' }), line(4, { position: '1' }), line(5, { deleted_at: '2026-11-19T10:00:00.000Z' }), line(6, { sale_id: 'S9' })];
    expect(linesOf(lines, 'S2').map((l) => l.id)).toEqual(['L4', 'L3']);
    expect(sortSales([sale(2, { date: '2026-11-01' }), sale(3), sale(4)]).map((s) => s.id)).toEqual(['S4', 'S3', 'S2']);
  });
});

describe('bag counts', () => {
  it('counts the bags and the free ones (the owner example: 3 kg + 1 kg free)', () => {
    expect(bagCount([line(3), line(4, { bags: '1', free: 'yes' })])).toEqual({ bags: 4, free: 1 });
  });
});

describe('validateSale', () => {
  it('stores a sale with its lines', () => {
    expect(validateSale(form(), ['C1'], ['P1'])).toEqual({
      ok: true,
      fields: { date: '2026-11-19', kind: 'sale', client_id: 'C1', place: '', reason: '', notes: '' },
      lines: [{ position: '1', product_id: 'P1', bag_size_g: '1000', bags: '3', unit_price_net_pln: '', free: '' }],
    });
  });

  it('stores free bags (no prices in Sales: the owner takes them from the offer)', () => {
    const result = validateSale(form({ lines: [{ productId: 'P1', grams: '1000', bags: '1', free: true }] }), ['C1'], ['P1']);
    expect(result).toMatchObject({ ok: true, lines: [{ free: 'yes', unit_price_net_pln: '' }] });
  });

  it('stores a sample at a place that is not a client, and own use with a reason, without prices', () => {
    const sample = validateSale(form({ kind: 'sample', clientId: '', place: '  Café  Nowa, Kazimierz ' }), ['C1'], ['P1']);
    expect(sample).toMatchObject({ ok: true, fields: { kind: 'sample', client_id: '', place: 'Café Nowa, Kazimierz' }, lines: [{ unit_price_net_pln: '', free: '' }] });
    const own = validateSale(form({ kind: 'own_use', reason: 'Tasting at home' }), ['C1'], ['P1']);
    expect(own).toMatchObject({ ok: true, fields: { kind: 'own_use', client_id: '', reason: 'Tasting at home' } });
  });

  it('explains what is missing', () => {
    const result = validateSale(
      form({ date: '', clientId: '', lines: [{ productId: '', grams: '300', bags: '0', free: false }, emptyLine()] }),
      ['C1'],
      ['P1'],
    );
    expect(result).toEqual({
      ok: false,
      errors: {
        date: 'Wpisz datę, np. 19.11.2026.',
        client: 'Wybierz klienta (nowych dodasz w zakładce Klienci).',
        line: [
          'Pozycja 1: wybierz produkt, wybierz wielkość torebki, wpisz liczbę torebek (od 1 do 999).',
          'Pozycja 2: wybierz produkt.',
        ],
      },
    });
    expect(validateSale(form({ kind: 'sample', clientId: '' }), ['C1'], ['P1'])).toMatchObject({ ok: false, errors: { place: 'Wybierz klienta albo wpisz, gdzie została próbka, np. Café Nowa, Kazimierz.' } });
    expect(validateSale(form({ kind: 'own_use' }), ['C1'], ['P1'])).toMatchObject({ ok: false, errors: { reason: 'Napisz, po co, np. na degustację w domu.' } });
    expect(validateSale(form({ lines: [] }), ['C1'], ['P1'])).toMatchObject({ ok: false, errors: { lines: 'Dodaj co najmniej jeden produkt.' } });
  });

  it('names lines of a sale or own use that are not a bag size (only samples can be any amount)', () => {
    const sales = [sale(2), sale(3, { kind: 'sample', invoice_status: '' })];
    const lines = [line(4, { sale_id: 'S2', bag_size_g: '300' }), line(5, { sale_id: 'S3', bag_size_g: '150' }), line(6, { sale_id: 'S2', bag_size_g: '250' }), line(7, { sale_id: 'S9', bag_size_g: '300' })];
    expect(lineSizeProblems(sales, lines)).toEqual(['Wiersz 4 zakładki „Sale lines” ma 300 g, a dowolną gramaturę mogą mieć tylko próbki: otwórz wpis i wybierz wielkość torebki.']);
  });

  it('takes any amount in grams for a sample (e.g. 150 g), but only the bag sizes for a sale or own use', () => {
    const lines = [{ productId: 'P1', grams: '150', bags: '1', free: false }];
    expect(validateSale(form({ kind: 'sample', lines }), ['C1'], ['P1'])).toMatchObject({ ok: true, lines: [{ bag_size_g: '150', bags: '1' }] });
    expect(validateSale(form({ kind: 'sale', lines }), ['C1'], ['P1'])).toMatchObject({ ok: false, errors: { line: ['Pozycja 1: wybierz wielkość torebki.'] } });
    expect(validateSale(form({ kind: 'own_use', reason: 'Tasting', lines }), ['C1'], ['P1'])).toMatchObject({ ok: false, errors: { line: ['Pozycja 1: wybierz wielkość torebki.'] } });
    for (const grams of ['0', '12.5', '6000', '']) {
      expect(validateSale(form({ kind: 'sample', lines: [{ ...lines[0]!, grams }] }), ['C1'], ['P1'])).toMatchObject({ ok: false, errors: { line: ['Pozycja 1: wpisz gramaturę w gramach (od 1 do 5000).'] } });
    }
    expect(validateSale(form({ kind: 'sample', lines: [{ ...lines[0]!, bags: '' }] }), ['C1'], ['P1'])).toMatchObject({ ok: false, errors: { line: ['Pozycja 1: wpisz liczbę opakowań (od 1 do 999).'] } });
  });
});

describe('the invoice status', () => {
  it('starts as to be issued for a sale, and has none for samples and own use', () => {
    expect(startingInvoice('sale')).toEqual({ invoice_status: 'to_issue' });
    expect(startingInvoice('sample')).toEqual({ invoice_status: '', invoice_number: '', invoice_date: '', paid_date: '' });
  });

  const issued = sale(2, { invoice_status: 'issued', invoice_date: '2026-11-12' });
  const paid = sale(3, { invoice_status: 'paid', invoice_date: '2026-11-12', paid_date: '2026-11-15' });
  const toIssue = sale(4);

  it('offers the issue date the sale already has, else today', () => {
    expect(suggestedInvoiceDate(toIssue, '2026-11-19')).toBe('2026-11-19');
    expect(suggestedInvoiceDate(issued, '2026-11-19')).toBe('2026-11-12');
    expect(suggestedInvoiceDate(paid, '2026-11-19')).toBe('2026-11-12');
    // a stale date in a "to be issued" sale, or one that cannot be read, is not offered
    expect(suggestedInvoiceDate(sale(5, { invoice_date: '2026-10-01' }), '2026-11-19')).toBe('2026-11-19');
    expect(suggestedInvoiceDate(sale(6, { invoice_status: 'issued', invoice_date: 'soon' }), '2026-11-19')).toBe('2026-11-19');
  });

  it('asks for the issue date for Issued, and for Paid only when none is known; never for "to be issued"', () => {
    expect(needsInvoiceDate(toIssue, 'issued')).toBe(true);
    expect(needsInvoiceDate(paid, 'issued')).toBe(true);
    expect(needsInvoiceDate(toIssue, 'paid')).toBe(true);
    expect(needsInvoiceDate(issued, 'paid')).toBe(false);
    expect(needsInvoiceDate(issued, 'to_issue')).toBe(false);
  });

  it('saves the issue date typed', () => {
    expect(statusChange(toIssue, 'issued', '2026-11-18')).toEqual({ ok: true, fields: { invoice_status: 'issued', invoice_date: '2026-11-18' } });
    expect(statusChange(paid, 'issued', '2026-11-13')).toEqual({ ok: true, fields: { invoice_status: 'issued', invoice_date: '2026-11-13' } });
    expect(statusChange(toIssue, 'paid', '2026-11-18')).toEqual({ ok: true, fields: { invoice_status: 'paid', invoice_date: '2026-11-18' } });
  });

  it('paid keeps the issue date already known, and has no date of its own', () => {
    expect(statusChange(issued, 'paid', '')).toEqual({ ok: true, fields: { invoice_status: 'paid', invoice_date: '2026-11-12' } });
  });

  it('refuses an empty or wrong issue date', () => {
    expect(statusChange(toIssue, 'issued', '')).toEqual({ ok: false, error: 'Wpisz datę wystawienia faktury.' });
    expect(statusChange(toIssue, 'paid', '2026-02-30')).toEqual({ ok: false, error: 'Wpisz datę wystawienia faktury.' });
  });

  it('going back to "to be issued" clears the issue date (a mistake can be undone)', () => {
    expect(statusChange(paid, 'to_issue', '')).toEqual({ ok: true, fields: { invoice_status: 'to_issue', invoice_date: '' } });
  });
});

describe('editing', () => {
  it('fills the form from a sale and its lines', () => {
    expect(formFromSale(sale(2), [line(3)])).toMatchObject({ kind: 'sale', clientId: 'C1', lines: [{ productId: 'P1', grams: '1000', bags: '3', free: false }] });
  });

  it('a changed kind starts the invoice again; an unreadable kind with a readable status keeps it', () => {
    const fields = { date: '2026-11-19', kind: 'sale', client_id: 'C1', place: '', reason: '', notes: '' };
    expect(saleEditFields(sale(2, { invoice_status: 'paid' }), 'sale', fields)).toEqual(fields);
    expect(saleEditFields(sale(2, { kind: 'sample', invoice_status: '' }), 'sale', fields)).toEqual({ ...fields, invoice_status: 'to_issue' });
    expect(saleEditFields(sale(2), 'own_use', fields)).toEqual({ ...fields, invoice_status: '', invoice_number: '', invoice_date: '', paid_date: '' });
    const typo = sale(2, { kind: 'Sale', invoice_status: 'paid' });
    expect(changedSaleFields(typo, saleEditFields(typo, 'sale', fields))).toEqual({ kind: 'sale' });
    expect(saleEditFields(sale(2, { kind: 'Sale', invoice_status: 'whatever' }), 'sale', fields)).toMatchObject({ invoice_status: 'to_issue' });
  });

  it('accepts the client and products the entry already has, even when deleted since', () => {
    expect(choosableIds(['C1'], ['P1'], sale(2, { client_id: 'C9' }), [line(3, { product_id: 'P9' })])).toEqual({ clientIds: ['C1', 'C9'], productIds: ['P1', 'P9'] });
    expect(choosableIds(['C1'], ['P1'], null, [])).toEqual({ clientIds: ['C1'], productIds: ['P1'] });
    const old = sale(2, { client_id: 'C9' });
    const { clientIds, productIds } = choosableIds(['C1'], ['P1'], old, [line(3, { product_id: 'P9' })]);
    expect(validateSale(form({ clientId: 'C9', lines: [{ productId: 'P9', grams: '1000', bags: '2', free: false }] }), clientIds, productIds)).toMatchObject({ ok: true });
  });

  it('writes only the sale cells that changed', () => {
    const s = sale(2);
    expect(changedSaleFields(s, { date: '2026-11-19', kind: 'sale', client_id: 'C2', place: '', reason: '', notes: '' })).toEqual({ client_id: 'C2' });
  });
});
