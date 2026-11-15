import { describe, expect, it } from 'vitest';
import { lotFromFields } from '../lots';
import type { RoastimeBean, RoastimeContainer, RoastimeData } from './model';
import { defaultDecision, differences, newLotCodes, operations, planImport, type Decision } from './plan';

const today = new Date(2026, 10, 15, 12);
const container = (o: Partial<RoastimeContainer> = {}): RoastimeContainer => ({
  id: 'C1',
  beanId: 'B1',
  startGrams: 60000,
  deleted: false,
  createdAt: new Date(2026, 10, 3, 12),
  ...o,
});
const bean = (o: Partial<RoastimeBean> = {}): RoastimeBean => ({
  id: 'B1',
  name: 'Kenya Kegwa',
  country: 'Kenya',
  region: 'Nyeri',
  process: 'Washed',
  vendorCode: 'V1',
  ...o,
});
const data = (containers: RoastimeContainer[], beans: RoastimeBean[] = [bean()]): RoastimeData => ({ containers, beans, problems: [] });
let row = 1;
const lot = (fields: Record<string, string>) =>
  lotFromFields(
    {
      id: `L${++row}`,
      code: 'KENYA-26-11',
      name: 'Kenya Kegwa',
      country: 'Kenya',
      region: 'Nyeri',
      process: 'Washed',
      quantity_kg: '60',
      delivery_date: '2026-11-03',
      coffee_price_net_pln: '4500',
      supplier: 'Made-up Importers',
      deleted_at: '',
      ...fields,
    },
    row,
  );
const linked = (fields: Record<string, string> = {}) => lot({ roastime_container_id: 'C1', roastime_bean_id: 'B1', roastime_supplier_code: 'V1', ...fields });

describe('planImport: new deliveries', () => {
  it('prepares a new lot from RoasTime with a suggested code and no prices', () => {
    const plan = planImport(data([container()]), [], today);
    expect(plan.items).toEqual([
      {
        kind: 'new',
        container: container(),
        bean: bean(),
        fields: {
          code: 'KENYA-26-11',
          name: 'Kenya Kegwa',
          country: 'Kenya',
          region: 'Nyeri',
          process: 'Washed',
          supplier: '',
          delivery_date: '2026-11-03',
          quantity_kg: '60',
          altitude: '',
          variety: '',
          coffee_price_net_pln: '',
          delivery_cost_net_pln: '',
          notes: '',
          roastime_container_id: 'C1',
          roastime_bean_id: 'B1',
          roastime_supplier_code: 'V1',
        },
      },
    ]);
  });

  it('gives two new deliveries in the same month different codes, after existing ones', () => {
    const existing = lot({ code: 'KENYA-26-11', quantity_kg: '1', roastime_container_id: 'OTHER' });
    const plan = planImport(data([container({ id: 'C1' }), container({ id: 'C2', createdAt: new Date(2026, 10, 20, 12) })]), [existing], today);
    const both = new Map<string, Decision>([['C1', { action: 'add' }], ['C2', { action: 'add' }]]);
    expect([...newLotCodes(plan, both).values()]).toEqual(['KENYA-26-11-B', 'KENYA-26-11-C']);
    expect(operations(plan, both).map((op) => op.kind === 'add' && op.fields.code)).toEqual(['KENYA-26-11-B', 'KENYA-26-11-C']);
  });

  it('gives codes only to the deliveries that are added, so skipping leaves no gap', () => {
    const plan = planImport(data([container({ id: 'C1' }), container({ id: 'C2', createdAt: new Date(2026, 10, 20, 12) })]), [], today);
    const skipFirst = new Map<string, Decision>([['C1', { action: 'skip' }], ['C2', { action: 'add' }]]);
    expect(newLotCodes(plan, skipFirst)).toEqual(new Map([['C2', 'KENYA-26-11']]));
  });

  it('fills in the supplier already known for the same RoasTime supplier code', () => {
    const known = lot({ supplier: 'Made-up Importers', roastime_supplier_code: 'V1', roastime_container_id: 'OLD', quantity_kg: '30' });
    const [item] = planImport(data([container()]), [known], today).items;
    expect(item?.kind === 'new' && item.fields.supplier).toBe('Made-up Importers');
  });

  it('uses today when RoasTime has no creation time', () => {
    const [item] = planImport(data([container({ createdAt: null })]), [], today).items;
    expect(item?.kind === 'new' && item.fields.delivery_date).toBe('2026-11-15');
  });

  it('never matches or changes lots entered by hand, even if they look the same (owner, 2026-11-15)', () => {
    const handEntered = lot({ name: 'Kenya kegwa' });
    const plan = planImport(data([container()]), [handEntered], today);
    expect(plan.items.map((i) => i.kind)).toEqual(['new']);
    expect(plan.items[0] && defaultDecision(plan.items[0])).toEqual({ action: 'add' });
    expect(operations(plan, new Map([['C1', { action: 'add' }]])).every((op) => op.kind === 'add')).toBe(true);
  });

  it.each([
    ['no country', container(), bean({ country: '' }), 'Enter the country.'],
    ['no name', container(), bean({ name: '' }), 'Enter the coffee name.'],
    ['0 kg', container({ startGrams: 0 }), bean(), 'The quantity must be more than 0.'],
    ['a very long name', container(), bean({ name: 'x'.repeat(201) }), 'Use at most 200 characters.'],
  ])('never imports a broken lot (%s): it is reported instead', (_name, c, b, reason) => {
    const plan = planImport(data([c], [b]), [], today);
    expect(plan.items).toEqual([]);
    expect(plan.problems).toHaveLength(1);
    expect(plan.problems[0]).toContain(reason);
    expect(plan.problems[0]).toContain('Correct it in RoasTime, or add the lot by hand.');
  });

  it('ignores deliveries deleted in RoasTime that Kraken never had', () => {
    expect(planImport(data([container({ deleted: true })]), [], today).items).toEqual([]);
  });

  it('reports a delivery whose coffee is missing', () => {
    const plan = planImport(data([container()], []), [], today);
    expect(plan.items).toEqual([]);
    expect(plan.problems).toEqual(['A RoasTime delivery (60\u00a0kg) points to a coffee Kraken cannot find, so it was skipped.']);
  });
});

describe('planImport: deliveries already in Kraken', () => {
  it('reports nothing to do when they match', () => {
    const [item] = planImport(data([container()]), [linked()], today).items;
    expect(item?.kind).toBe('same');
    expect(item && defaultDecision(item)).toBeNull();
  });

  it('lists what RoasTime changed, with readable values', () => {
    const [item] = planImport(data([container({ startGrams: 59500 })], [bean({ name: 'Kenya Kegwa AA', process: 'Natural' })]), [linked()], today).items;
    expect(item?.kind === 'changed' && item.differences).toEqual([
      { column: 'name', label: 'Name', kraken: 'Kenya Kegwa', roastime: 'Kenya Kegwa AA', value: 'Kenya Kegwa AA' },
      { column: 'process', label: 'Process', kraken: 'Washed', roastime: 'Natural', value: 'Natural' },
      { column: 'quantity_kg', label: 'Quantity', kraken: '60 kg', roastime: '59,5 kg', value: '59.5' },
    ]);
  });

  it('never proposes to empty a field RoasTime has no value for', () => {
    const [item] = planImport(data([container()], [bean({ region: '', process: '' })]), [linked()], today).items;
    expect(item?.kind).toBe('same');
  });

  it('never offers a change the lot form would refuse (0 kg, too long), and says why', () => {
    const plan = planImport(data([container({ startGrams: 0 })], [bean({ name: 'x'.repeat(201) })]), [linked()], today);
    expect(plan.items.map((i) => i.kind)).toEqual(['same']);
    expect(plan.problems).toEqual([
      'RoasTime has a change for KENYA-26-11 that Kraken cannot store: the name is longer than 200 characters. Correct it in RoasTime.',
      'RoasTime has a change for KENYA-26-11 that Kraken cannot store: the quantity would be 0 kg. Correct it in RoasTime.',
    ]);
  });

  it('reports two lots linked to the same RoasTime delivery, and compares the active one', () => {
    const first = linked({ code: 'KENYA-26-11', deleted_at: '2026-11-10T10:00:00.000Z' });
    const second = linked({ code: 'KENYA-26-11-B' });
    const plan = planImport(data([container()]), [first, second], today);
    expect(plan.problems).toEqual(['Lots KENYA-26-11 and KENYA-26-11-B are all linked to the same RoasTime delivery. Delete the extra one in Kraken.']);
    expect(plan.items[0]).toMatchObject({ kind: 'same', lot: second });
  });

  it('only notes a delivery deleted in RoasTime (Kraken deletes nothing)', () => {
    const [item] = planImport(data([container({ deleted: true })]), [linked()], today).items;
    expect(item?.kind).toBe('deleted-in-roastime');
    expect(item && defaultDecision(item)).toBeNull();
  });

  it('leaves a lot deleted in Kraken alone', () => {
    const [item] = planImport(data([container()], [bean({ name: 'Changed' })]), [linked({ deleted_at: '2026-11-10T10:00:00.000Z' })], today).items;
    expect(item?.kind).toBe('deleted-in-kraken');
  });
});

describe('operations', () => {
  const decide = (entries: [string, Decision][]) => new Map(entries);

  it('adds new lots', () => {
    const plan = planImport(data([container()]), [], today);
    const ops = operations(plan, decide([['C1', { action: 'add' }]]));
    expect(ops).toEqual([{ kind: 'add', label: 'Add KENYA-26-11', fields: plan.items[0]?.kind === 'new' ? plan.items[0].fields : {} }]);
  });

  it('writes only the ticked differences of a changed lot, never prices or supplier', () => {
    const plan = planImport(data([container({ startGrams: 59500 })], [bean({ name: 'New name' })]), [linked()], today);
    const ops = operations(plan, decide([['C1', { action: 'update', accept: ['quantity_kg'] }]]));
    expect(ops).toEqual([{ kind: 'update', lot: expect.anything(), label: 'Update KENYA-26-11', fields: { quantity_kg: '59.5' } }]);
  });

  it('writes nothing for skipped items, items without a choice, or nothing ticked', () => {
    const plan = planImport(data([container({ id: 'C1' }), container({ id: 'C2' })], [bean()]), [linked({ roastime_container_id: 'C2', name: 'Old' })], today);
    expect(operations(plan, decide([['C1', { action: 'skip' }], ['C2', { action: 'update', accept: [] }]]))).toEqual([]);
    expect(operations(plan, new Map())).toEqual([]);
  });

  it('the default choices of a fresh plan, applied, give a plan with nothing left to do', () => {
    const plan = planImport(data([container()], [bean({ name: 'Kenya Kegwa AA' })]), [linked()], today);
    const ops = operations(plan, new Map(plan.items.flatMap((i) => { const d = defaultDecision(i); return d ? [[i.container.id, d] as [string, Decision]] : []; })));
    const op = ops[0];
    expect(op?.kind).toBe('update');
    const updated = op?.kind === 'update' ? lotFromFields({ ...op.lot.source, ...op.fields }, 2) : null;
    expect(updated && differences(updated, container(), bean({ name: 'Kenya Kegwa AA' }))).toEqual([]);
  });
});
