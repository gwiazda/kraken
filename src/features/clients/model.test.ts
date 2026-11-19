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
  });

  it('is written the usual way on the screen', () => {
    expect(formatNip('9876543210')).toBe('987-654-32-10');
    expect(formatNip('odd')).toBe('odd');
  });
});

describe('reading a client', () => {
  it('reads the cells', () => {
    expect(client(2)).toMatchObject({ name: 'Café Nowa', nip: '9876543210', email: 'kawa@example.com', registeredName: 'Nowa Kawa Sp. z o.o.', discountTenths: 150, problems: [] });
    expect(client(3, { discount_percent: '' }).discountTenths).toBeNull();
  });

  it('says which cells it cannot read', () => {
    expect(client(4, { nip: '123', discount_percent: '0.15' }).problems).toEqual([
      'The NIP "123" of Café Nowa is not a valid Polish tax ID. Edit the client to correct it.',
      'The discount "0.15" of Café Nowa cannot be read. Edit the client to correct it.',
    ]);
  });

  it('sorts by name the Polish way, deleted ones last', () => {
    const list = [client(2, { name: 'Ziarno' }), client(3, { name: 'Ćma', deleted_at: '2026-11-19T10:00:00.000Z' }), client(4, { name: 'Bar' }), client(5, { name: 'Ćwierć' })];
    expect(sortClients(list).map((c) => c.name)).toEqual(['Bar', 'Ćwierć', 'Ziarno', 'Ćma']);
  });
});

describe('the client form', () => {
  it('stores every column the same way every time', () => {
    const form = { ...emptyClientForm(), name: '  Café   Nowa ', nip: '987-654-32-10', email: ' kawa@example.com ', discount: '150' };
    expect(validateClientForm(form, [])).toEqual({
      ok: true,
      fields: { name: 'Café Nowa', nip: '9876543210', email: 'kawa@example.com', registered_name: '', discount_percent: '15' },
    });
    expect(validateClientForm({ ...emptyClientForm(), name: 'Sample place' }, [])).toMatchObject({ ok: true, fields: { nip: '', discount_percent: '' } }); // NIP and discount optional
  });

  it('explains what is wrong', () => {
    expect(validateClientForm({ name: '', nip: '1234567890', email: 'not an email', registeredName: '', discount: '7' }, [])).toEqual({
      ok: false,
      errors: {
        name: 'Enter the name you use for this client, e.g. Café Nowa.',
        nip: 'This is not a valid NIP: 10 digits, e.g. 123-456-32-18. Check it, or leave it empty.',
        email: 'Enter an email address, e.g. kawiarnia@example.com, or leave it empty.',
        discount: 'Choose a discount from the list.',
      },
    });
  });

  it('never adds the same client twice (name or NIP already used, deleted ones too)', () => {
    const existing = [client(2, { deleted_at: '2026-11-19T10:00:00.000Z' })];
    expect(validateClientForm({ ...emptyClientForm(), name: 'café nowa' }, existing)).toMatchObject({ ok: false, errors: { name: 'Another client already has this name.' } });
    expect(validateClientForm({ ...emptyClientForm(), name: 'Other', nip: '9876543210' }, existing)).toMatchObject({ ok: false, errors: { nip: 'Another client already has this NIP.' } });
  });

  it('an edit writes only the columns that changed', () => {
    const c = client(2);
    const result = validateClientForm({ ...formFromClient(c), email: 'new@example.com' }, []);
    if (!result.ok) throw new Error('expected valid');
    expect(changedClientFields(c, result.fields)).toEqual({ email: 'new@example.com' });
  });
});
