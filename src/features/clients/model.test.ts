import { describe, expect, it } from 'vitest';
import { changedClientFields, clientFromFields, emptyClientForm, formFromClient, formatNip, isValidNip, sortClients, validateClientForm } from './model';

// Made-up clients and tax IDs only (the repo is public). 9876543210 and 5550001119 have a valid check digit.
const client = (row: number, o: Record<string, string> = {}) =>
  clientFromFields({ id: `C${row}`, name: 'Café Nowa', nip: '9876543210', email: 'kawa@example.com', registered_name: 'Nowa Kawa Sp. z o.o.', discount_percent: '15', ...o }, row);

describe('NIP', () => {
  it('checks the check digit, ignoring spaces and dashes', () => {
    expect(isValidNip('9876543210')).toBe(true);
    expect(isValidNip('555-000-11-19')).toBe(true);
    expect(isValidNip('9876543211')).toBe(false);
    expect(isValidNip('123')).toBe(false);
    expect(isValidNip('abcdefghij')).toBe(false);
    expect(isValidNip('0000000000')).toBe(false); // passes the check digit, but no tax office code starts with 0
  });

  it('is written the usual way on the screen', () => {
    expect(formatNip('9876543210')).toBe('987-654-32-10');
    expect(formatNip('odd')).toBe('odd');
  });
});

describe('reading a client', () => {
  it('reads the cells', () => {
    expect(client(2)).toMatchObject({ name: 'Café Nowa', nip: '9876543210', email: 'kawa@example.com', registeredName: 'Nowa Kawa Sp. z o.o.', problems: [] });
  });

  it('says which cells it cannot read; the old discount column is not read any more (owner, 2026-11-27)', () => {
    expect(client(4, { nip: '123', discount_percent: '0.15' }).problems).toEqual(['NIP „123” (Café Nowa) nie jest prawidłowym numerem NIP. Kliknij klienta, aby go poprawić.']);
    expect(client(4)).not.toHaveProperty('discountTenths');
  });

  it('sorts by name the Polish way, deleted ones last', () => {
    const list = [client(2, { name: 'Ziarno' }), client(3, { name: 'Ćma', deleted_at: '2026-11-19T10:00:00.000Z' }), client(4, { name: 'Bar' }), client(5, { name: 'Ćwierć' })];
    expect(sortClients(list).map((c) => c.name)).toEqual(['Bar', 'Ćwierć', 'Ziarno', 'Ćma']);
  });
});

describe('the client form', () => {
  it('stores every column the same way every time', () => {
    const form = { ...emptyClientForm(), name: '  Café   Nowa ', nip: '987-654-32-10', email: ' kawa@example.com ' };
    expect(validateClientForm(form, [])).toEqual({
      ok: true,
      fields: { name: 'Café Nowa', nip: '9876543210', email: 'kawa@example.com', registered_name: '' }, // never the discount column
    });
    expect(validateClientForm({ ...emptyClientForm(), name: 'Sample place' }, [])).toMatchObject({ ok: true, fields: { nip: '' } }); // NIP optional
  });

  it('explains what is wrong', () => {
    expect(validateClientForm({ name: '', nip: '1234567890', email: 'not an email', registeredName: '' }, [])).toEqual({
      ok: false,
      errors: {
        name: 'Wpisz nazwę, której używasz dla tego klienta, np. Café Nowa.',
        nip: 'To nie jest prawidłowy NIP: 10 cyfr, np. 123-456-32-18. Sprawdź go albo zostaw puste.',
        email: 'Wpisz adres e-mail, np. kawiarnia@example.com, albo zostaw puste.',
      },
    });
  });

  it('never adds the same client twice (name or NIP already used, deleted ones too)', () => {
    const existing = [client(2, { deleted_at: '2026-11-19T10:00:00.000Z' })];
    expect(validateClientForm({ ...emptyClientForm(), name: 'café nowa' }, existing)).toMatchObject({ ok: false, errors: { name: 'Inny klient ma już taką nazwę.' } });
    expect(validateClientForm({ ...emptyClientForm(), name: 'Other', nip: '9876543210' }, existing)).toMatchObject({ ok: false, errors: { nip: 'Inny klient ma już ten NIP.' } });
  });

  it('an edit leaves the old discount cell exactly as it is', () => {
    const old = client(2, { discount_percent: '15' });
    const result = validateClientForm({ ...formFromClient(old), email: 'new@example.com' }, []);
    if (!result.ok) throw new Error('expected valid');
    expect(changedClientFields(old, result.fields)).toEqual({ email: 'new@example.com' });
  });

  it('compares names without extra spaces or capitals', () => {
    expect(validateClientForm({ ...emptyClientForm(), name: 'Café Nowa' }, [client(2, { name: 'Café  Nowa ' })])).toMatchObject({ ok: false, errors: { name: 'Inny klient ma już taką nazwę.' } });
  });

  it('an edit writes only the columns that changed', () => {
    const c = client(2);
    const result = validateClientForm({ ...formFromClient(c), email: 'new@example.com' }, []);
    if (!result.ok) throw new Error('expected valid');
    expect(changedClientFields(c, result.fields)).toEqual({ email: 'new@example.com' });
  });
});
