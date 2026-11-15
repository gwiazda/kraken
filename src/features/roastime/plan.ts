// The RoasTime import plan: compares RoasTime's deliveries with Kraken's lots and turns the owner's choices into
// changes. Pure, so every rule is tested. Rules agreed with the owner on 2026-11-15:
// - RoasTime is the source of truth for name, country, region, process and the delivered kg, but every difference is
//   shown and only written when ticked
// - prices, delivery cost, supplier, notes, code, altitude, variety and an existing lot's delivery date are never touched
// - only lots imported from RoasTime before are matched (by RoasTime's delivery ID); lots entered by hand are never
//   matched or changed (owner's decision, 2026-11-15): every RoasTime delivery not imported yet is offered as a new lot
// - nothing in Kraken is deleted because of RoasTime

import { localDate } from '../../core/dates';
import { formatKg, kgText } from '../../core/numbers';
import { suggestCode, validateLotForm, type Lot } from '../lots';
import type { RoastimeBean, RoastimeContainer, RoastimeData } from './model';

export type DiffColumn = 'name' | 'country' | 'region' | 'process' | 'quantity_kg';

export interface Difference {
  readonly column: DiffColumn;
  readonly label: string;
  readonly kraken: string;
  readonly roastime: string;
  /** The value to store if accepted. */
  readonly value: string;
}

export type ImportItem =
  /** Not imported yet. `fields` is the new lot. */
  | { readonly kind: 'new'; readonly container: RoastimeContainer; readonly bean: RoastimeBean; readonly fields: Readonly<Record<string, string>> }
  | { readonly kind: 'changed'; readonly container: RoastimeContainer; readonly bean: RoastimeBean; readonly lot: Lot; readonly differences: readonly Difference[] }
  | { readonly kind: 'same'; readonly container: RoastimeContainer; readonly lot: Lot }
  /** Deleted in RoasTime but still a lot in Kraken: only a note, Kraken deletes nothing because of RoasTime. */
  | { readonly kind: 'deleted-in-roastime'; readonly container: RoastimeContainer; readonly lot: Lot }
  /** Linked to a lot that was deleted in Kraken: left alone (restore it in Kraken if needed). */
  | { readonly kind: 'deleted-in-kraken'; readonly container: RoastimeContainer; readonly lot: Lot };

export interface ImportPlan {
  readonly items: readonly ImportItem[];
  readonly problems: readonly string[];
}

const LABELS: Record<DiffColumn, string> = { name: 'Name', country: 'Country', region: 'Region', process: 'Process', quantity_kg: 'Quantity' };

/** What RoasTime says, for each column it is the source of truth for. */
function roastimeValues(container: RoastimeContainer, bean: RoastimeBean): Record<DiffColumn, string> {
  return { name: bean.name, country: bean.country, region: bean.region, process: bean.process, quantity_kg: kgText(container.startGrams) };
}

/** The differences between a Kraken lot and a RoasTime delivery, in the columns RoasTime is the source of truth for. */
export function differences(lot: Lot, container: RoastimeContainer, bean: RoastimeBean): Difference[] {
  const rt = roastimeValues(container, bean);
  const kraken: Record<DiffColumn, string> = {
    name: lot.name,
    country: lot.country,
    region: lot.region,
    process: lot.process,
    quantity_kg: lot.quantityGrams === null ? (lot.source.quantity_kg ?? '').trim() : kgText(lot.quantityGrams),
  };
  return (Object.keys(LABELS) as DiffColumn[])
    .filter((column) => kraken[column] !== rt[column] && !(column !== 'quantity_kg' && rt[column] === '' && kraken[column] !== ''))
    .map((column) => ({
      column,
      label: LABELS[column],
      kraken: column === 'quantity_kg' && lot.quantityGrams !== null ? formatKg(lot.quantityGrams) : kraken[column] || '(empty)',
      roastime: column === 'quantity_kg' ? formatKg(container.startGrams) : rt[column],
      value: rt[column],
    }));
}

export function planImport(data: RoastimeData, lots: readonly Lot[], today: Date): ImportPlan {
  const problems = [...data.problems];
  const beans = new Map(data.beans.map((bean) => [bean.id, bean]));
  /** Codes given to new lots earlier in this same import. */
  const plannedCodes: string[] = [];
  const items: ImportItem[] = [];

  const ordered = [...data.containers].sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0));
  for (const container of ordered) {
    const lot = lots.find((l) => l.roastime.containerId === container.id);
    if (lot) {
      if (lot.deletedAt !== '') items.push({ kind: 'deleted-in-kraken', container, lot });
      else if (container.deleted) items.push({ kind: 'deleted-in-roastime', container, lot });
      else {
        const bean = beans.get(container.beanId);
        if (!bean) {
          problems.push(`RoasTime delivery for ${lot.code} points to a coffee Kraken cannot find, so it was not compared.`);
          continue;
        }
        const diff = differences(lot, container, bean);
        items.push(diff.length > 0 ? { kind: 'changed', container, bean, lot, differences: diff } : { kind: 'same', container, lot });
      }
      continue;
    }
    if (container.deleted) continue; // deleted in RoasTime and never in Kraken: nothing to do
    const bean = beans.get(container.beanId);
    if (!bean) {
      problems.push(`A RoasTime delivery (${kgText(container.startGrams)} kg) points to a coffee Kraken cannot find, so it was skipped.`);
      continue;
    }
    const deliveryDate = localDate(container.createdAt ?? today);
    const code = suggestCode(bean.country, deliveryDate, [...lots.map((l) => l.code), ...plannedCodes]);
    const supplier =
      bean.vendorCode === '' ? '' : (lots.find((l) => l.roastime.supplierCode === bean.vendorCode && l.supplier !== '')?.supplier ?? '');
    // The same checks as a lot typed by hand (code, name, country, kg, lengths), so an import never stores a broken lot.
    const checked = validateLotForm(
      {
        code,
        name: bean.name,
        country: bean.country,
        region: bean.region,
        altitude: '',
        process: bean.process,
        variety: '',
        supplier,
        deliveryDate,
        quantityKg: kgText(container.startGrams),
        coffeePrice: '',
        deliveryCost: '',
        notes: '',
      },
      // Only `code` of the other lots is used by the uniqueness check.
      [...lots, ...plannedCodes.map((c) => ({ code: c }) as Lot)],
    );
    if (!checked.ok) {
      const what = `RoasTime delivery "${bean.name || 'no name'}" (${kgText(container.startGrams)} kg)`;
      problems.push(`${what} cannot be imported: ${Object.values(checked.errors).join(' ')} Correct it in RoasTime, or add the lot by hand.`);
      continue;
    }
    plannedCodes.push(checked.fields.code ?? code);
    items.push({
      kind: 'new',
      container,
      bean,
      fields: {
        ...checked.fields,
        roastime_container_id: container.id,
        roastime_bean_id: bean.id,
        roastime_supplier_code: bean.vendorCode,
      },
    });
  }
  return { items, problems };
}

/** The owner's choice for one item. `accept`: the differences to write (for a changed lot). */
export type Decision = { readonly action: 'add' | 'skip' } | { readonly action: 'update'; readonly accept: readonly DiffColumn[] };

/** Preselected choices: add new deliveries; accept every difference. */
export function defaultDecision(item: ImportItem): Decision | null {
  if (item.kind === 'new') return { action: 'add' };
  if (item.kind === 'changed') return { action: 'update', accept: item.differences.map((d) => d.column) };
  return null;
}

export type Operation =
  | { readonly kind: 'add'; readonly fields: Readonly<Record<string, string>>; readonly label: string }
  | { readonly kind: 'update'; readonly lot: Lot; readonly fields: Readonly<Record<string, string>>; readonly label: string };

/** Turns the plan and the choices into the writes to make. Items without a choice (or skipped) write nothing. */
export function operations(plan: ImportPlan, decisions: ReadonlyMap<string, Decision>): Operation[] {
  const ops: Operation[] = [];
  for (const item of plan.items) {
    const decision = decisions.get(item.container.id);
    if (!decision || decision.action === 'skip') continue;
    if (item.kind === 'new' && decision.action === 'add') {
      ops.push({ kind: 'add', fields: item.fields, label: `Add ${item.fields.code}` });
    } else if (item.kind === 'changed' && decision.action === 'update') {
      const accepted = item.differences.filter((d) => decision.accept.includes(d.column));
      if (accepted.length > 0) {
        ops.push({ kind: 'update', lot: item.lot, label: `Update ${item.lot.code}`, fields: Object.fromEntries(accepted.map((d) => [d.column, d.value])) });
      }
    }
  }
  return ops;
}
