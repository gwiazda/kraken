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
  /** Codes of the lots already in Kraken (deleted ones too), so new codes never clash. */
  readonly existingCodes: readonly string[];
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

/** Why a RoasTime value cannot be stored on an existing lot (the lot form's rules), or null if it can. */
function invalidValue(difference: Difference): string | null {
  if (difference.column === 'quantity_kg' && difference.value === '0') return 'the quantity would be 0 kg';
  if (difference.value.length > MAX_TEXT) return `the ${difference.label.toLowerCase()} is longer than ${MAX_TEXT} characters`;
  return null;
}

const MAX_TEXT = 200;

export function planImport(data: RoastimeData, lots: readonly Lot[], today: Date): ImportPlan {
  const problems = [...data.problems];
  const beans = new Map(data.beans.map((bean) => [bean.id, bean]));
  const existingCodes = lots.map((lot) => lot.code);
  const items: ImportItem[] = [];

  // Lots per RoasTime delivery. Two lots for one delivery is a mistake to report (stock would count twice).
  const linked = new Map<string, Lot[]>();
  for (const lot of lots) {
    if (lot.roastime.containerId !== '') linked.set(lot.roastime.containerId, [...(linked.get(lot.roastime.containerId) ?? []), lot]);
  }
  for (const group of linked.values()) {
    if (group.length > 1) {
      problems.push(`Lots ${group.map((l) => l.code).join(' and ')} are all linked to the same RoasTime delivery. Delete the extra one in Kraken.`);
    }
  }
  const supplierByVendor = new Map<string, string>();
  for (const lot of lots) {
    if (lot.roastime.supplierCode !== '' && lot.supplier !== '' && !supplierByVendor.has(lot.roastime.supplierCode)) {
      supplierByVendor.set(lot.roastime.supplierCode, lot.supplier);
    }
  }

  const ordered = [...data.containers].sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0));
  for (const container of ordered) {
    const group = linked.get(container.id) ?? [];
    const lot = group.find((l) => l.deletedAt === '') ?? group[0];
    if (lot) {
      if (lot.deletedAt !== '') items.push({ kind: 'deleted-in-kraken', container, lot });
      else if (container.deleted) items.push({ kind: 'deleted-in-roastime', container, lot });
      else {
        const bean = beans.get(container.beanId);
        if (!bean) {
          problems.push(`RoasTime delivery for ${lot.code} points to a coffee Kraken cannot find, so it was not compared.`);
          continue;
        }
        // The same rules as the lot form: a RoasTime value Kraken could not store is reported, not offered.
        const diff = differences(lot, container, bean).filter((d) => {
          const reason = invalidValue(d);
          if (reason) problems.push(`RoasTime has a change for ${lot.code} that Kraken cannot store: ${reason}. Correct it in RoasTime.`);
          return reason === null;
        });
        items.push(diff.length > 0 ? { kind: 'changed', container, bean, lot, differences: diff } : { kind: 'same', container, lot });
      }
      continue;
    }
    if (container.deleted) continue; // deleted in RoasTime and never in Kraken: nothing to do
    const bean = beans.get(container.beanId);
    if (!bean) {
      problems.push(`A RoasTime delivery (${formatKg(container.startGrams)}) points to a coffee Kraken cannot find, so it was skipped.`);
      continue;
    }
    const deliveryDate = localDate(container.createdAt ?? today);
    const supplier = supplierByVendor.get(bean.vendorCode) ?? '';
    // The same checks as a lot typed by hand (code, name, country, kg, lengths), so an import never stores a broken lot.
    // The final code is given when the owner has chosen what to add (see newLotCodes), so skipped ones leave no gaps.
    const checked = validateLotForm(
      {
        code: suggestCode(bean.country, deliveryDate, existingCodes),
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
      lots,
    );
    if (!checked.ok) {
      const what = `RoasTime delivery "${bean.name || 'no name'}" (${formatKg(container.startGrams)})`;
      problems.push(`${what} cannot be imported: ${Object.values(checked.errors).join(' ')} Correct it in RoasTime, or add the lot by hand.`);
      continue;
    }
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
  return { items, problems, existingCodes };
}

/**
 * The codes of the new lots the owner chose to add, given in delivery order: KENYA-26-11, then -B… A skipped
 * delivery gets no code, so the added ones have no gaps.
 */
export function newLotCodes(plan: ImportPlan, decisions: ReadonlyMap<string, Decision>): Map<string, string> {
  const taken = [...plan.existingCodes];
  const codes = new Map<string, string>();
  for (const item of plan.items) {
    if (item.kind !== 'new' || decisions.get(item.container.id)?.action !== 'add') continue;
    const code = suggestCode(item.fields.country ?? '', item.fields.delivery_date ?? '', taken);
    taken.push(code);
    codes.set(item.container.id, code);
  }
  return codes;
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
  const codes = newLotCodes(plan, decisions);
  for (const item of plan.items) {
    const decision = decisions.get(item.container.id);
    if (!decision || decision.action === 'skip') continue;
    if (item.kind === 'new' && decision.action === 'add') {
      const code = codes.get(item.container.id) ?? item.fields.code ?? '';
      ops.push({ kind: 'add', fields: { ...item.fields, code }, label: `Add ${code}` });
    } else if (item.kind === 'changed' && decision.action === 'update') {
      const accepted = item.differences.filter((d) => decision.accept.includes(d.column));
      if (accepted.length > 0) {
        ops.push({ kind: 'update', lot: item.lot, label: `Update ${item.lot.code}`, fields: Object.fromEntries(accepted.map((d) => [d.column, d.value])) });
      }
    }
  }
  return ops;
}
