// Roasts (the roasting log). Pure logic only: no Google, no screen. Columns agreed with the owner on 2026-11-15,
// see docs/REQUIREMENTS.md section 3. Weights are kept in grams (green as whole grams; roasted may have one decimal,
// RoasTime writes e.g. 132.5).

import { formatDateTime, localDate } from '../../core/dates';
import { parseDecimal, toDecimalText } from '../../core/numbers';
import { count } from '../../core/polish';

export const ROASTS_TAB = 'Roasts';

/** The Roasts columns a feature writes (the safety columns id, created_at, … are handled by the table). */
export const ROAST_COLUMNS = [
  'roasted_at',
  'roast_name',
  'green_g',
  'roasted_g',
  'lot_id',
  'sample',
  'notes',
  'roastime_roast_id',
  'roastime_bean_id',
] as const;

export interface Roast {
  readonly id: string;
  readonly row: number;
  /** When it was roasted, or null if the cell is not a readable time. */
  readonly roastedAt: Date | null;
  readonly name: string;
  /** Green coffee used, in whole grams; null if missing or unreadable. */
  readonly greenGrams: number | null;
  /** Roasted weight in tenths of a gram (RoasTime writes e.g. 132.5 g); null if not entered. */
  readonly roastedDecigrams: number | null;
  /** The lot chosen by the owner (Kraken lot ID). Empty: Kraken chooses (oldest lot of the coffee first). */
  readonly lotId: string;
  readonly sample: boolean;
  readonly notes: string;
  readonly roastime: { readonly roastId: string; readonly beanId: string };
  readonly deletedAt: string;
  readonly problems: readonly string[];
  /** The row's fields exactly as loaded (for edits). */
  readonly source: Readonly<Record<string, string>>;
}

type Fields = Readonly<Record<string, string>>;

export const parseGrams = (text: string) => parseDecimal(text, 0);
export const parseRoastedGrams = (text: string) => parseDecimal(text, 1);
export const gramsText = (grams: number) => toDecimalText(grams, 0);
export const roastedGramsText = (decigrams: number) => toDecimalText(decigrams, 1);

export function roastFromFields(fields: Fields, row: number): Roast {
  const text = (name: string) => (fields[name] ?? '').trim();
  const problems: string[] = [];
  const number = (name: string, label: string, parse: (t: string) => number | null | undefined) => {
    const value = parse(text(name));
    if (value === undefined) {
      problems.push(`${label} „${text(name)}” w wierszu ${row} to nie liczba, którą Kraken umie odczytać.`);
      return null;
    }
    return value;
  };
  let roastedAt: Date | null = null;
  if (text('roasted_at') !== '') {
    const time = new Date(text('roasted_at'));
    if (Number.isNaN(time.getTime())) problems.push(`Czas wypału „${text('roasted_at')}” w wierszu ${row} to nie czas, który Kraken umie odczytać.`);
    else roastedAt = time;
  }
  return {
    id: text('id'),
    row,
    roastedAt,
    name: text('roast_name'),
    greenGrams: number('green_g', 'Waga zielonej', parseGrams),
    roastedDecigrams: number('roasted_g', 'Waga palonej', parseRoastedGrams),
    lotId: text('lot_id'),
    sample: ['yes', 'true', '1'].includes(text('sample').toLowerCase()),
    notes: fields.notes ?? '',
    roastime: { roastId: text('roastime_roast_id'), beanId: text('roastime_bean_id') },
    deletedAt: text('deleted_at'),
    problems,
    source: fields,
  };
}

export const isRoastDeleted = (roast: Roast) => roast.deletedAt !== '';

/** Roast loss in tenths of a percent (e.g. 145 = 14,5 %): (green − roasted) ÷ green. Null if a weight is missing. */
export function roastLossPermille(roast: Pick<Roast, 'greenGrams' | 'roastedDecigrams'>): number | null {
  if (roast.greenGrams === null || roast.greenGrams === 0 || roast.roastedDecigrams === null) return null;
  const green = roast.greenGrams * 10; // decigrams
  return Math.round(((green - roast.roastedDecigrams) * 1000) / green);
}

/** "1 wypał", "2 wypały", "5 wypałów" (the same form after "dodano", "zaktualizowano"). */
export const roastsCount = (n: number) => count(n, 'wypał', 'wypały', 'wypałów');

/** "03.11.2026 09:15" in local time (the Polish way). */
export function roastTimeText(time: Date | null): string {
  return time ? formatDateTime(time) : '';
}

/** Oldest first; roasts without a time at the end. */
export function sortRoastsOldestFirst<T extends Pick<Roast, 'roastedAt' | 'id'>>(roasts: readonly T[]): T[] {
  return [...roasts].sort(
    (a, b) => (a.roastedAt?.getTime() ?? Number.MAX_SAFE_INTEGER) - (b.roastedAt?.getTime() ?? Number.MAX_SAFE_INTEGER) || a.id.localeCompare(b.id),
  );
}

/** The roast form, as typed. A roast from RoasTime only has lot, sample and notes editable. */
export interface RoastForm {
  date: string;
  time: string;
  name: string;
  greenG: string;
  roastedG: string;
  lotId: string;
  sample: boolean;
  notes: string;
}

export type RoastFormErrors = Partial<Record<keyof RoastForm, string>>;

export function emptyRoastForm(now: Date): RoastForm {
  const pad = (n: number) => String(n).padStart(2, '0');
  return { date: localDate(now), time: `${pad(now.getHours())}:${pad(now.getMinutes())}`, name: '', greenG: '', roastedG: '', lotId: '', sample: false, notes: '' };
}

export function formFromRoast(roast: Roast): RoastForm {
  const pad = (n: number) => String(n).padStart(2, '0');
  const at = roast.roastedAt;
  return {
    date: at ? localDate(at) : '',
    time: at ? `${pad(at.getHours())}:${pad(at.getMinutes())}` : '',
    name: roast.name,
    greenG: roast.greenGrams === null ? (roast.source.green_g ?? '').trim() : gramsText(roast.greenGrams),
    roastedG: roast.roastedDecigrams === null ? (roast.source.roasted_g ?? '').trim() : roastedGramsText(roast.roastedDecigrams),
    lotId: roast.lotId,
    sample: roast.sample,
    notes: roast.notes,
  };
}

/** True for a roast that came from RoasTime: its date, name and weights come from there and are not edited in Kraken. */
export const fromRoastime = (roast: Pick<Roast, 'roastime'>) => roast.roastime.roastId !== '';

/**
 * Checks the form. `full`: a roast entered by hand (date, weights … editable); otherwise only lot, sample and notes.
 * `lotIds`: the lots that can be chosen. Returns the fields to store, or errors per field.
 */
export function validateRoastForm(
  form: RoastForm,
  full: boolean,
  lotIds: readonly string[],
): { ok: true; fields: Record<string, string> } | { ok: false; errors: RoastFormErrors } {
  const errors: RoastFormErrors = {};
  const fields: Record<string, string> = {};
  if (form.lotId !== '' && !lotIds.includes(form.lotId)) errors.lotId = 'Wybierz jedną z dostaw z listy.';
  if (form.notes.length > 2000) errors.notes = 'Najwyżej 2000 znaków.';
  fields.lot_id = form.lotId;
  fields.sample = form.sample ? 'yes' : '';
  fields.notes = form.notes;
  if (full) {
    const date = form.date.trim();
    const time = form.time.trim() || '00:00';
    const at = /^\d{4}-\d{2}-\d{2}$/.test(date) && /^\d{2}:\d{2}$/.test(time) ? new Date(`${date}T${time}`) : null;
    if (date === '') errors.date = 'Wybierz datę wypału.';
    else if (!at || Number.isNaN(at.getTime()) || localDate(at) !== date) errors.date = 'Wybierz prawdziwą datę.';
    const green = parseGrams(form.greenG.trim());
    if (green === null) errors.greenG = 'Wpisz wagę zielonej kawy w gramach.';
    else if (green === undefined) errors.greenG = 'Wpisz pełne gramy, np. 1200.';
    else if (green === 0) errors.greenG = 'Waga zielonej kawy musi być większa od 0.';
    const roasted = parseRoastedGrams(form.roastedG.trim());
    if (roasted === undefined) errors.roastedG = 'Wpisz gramy, np. 1026 albo 1026,5, albo zostaw puste.';
    else if (typeof roasted === 'number' && typeof green === 'number' && roasted > green * 10) errors.roastedG = 'Waga palonej kawy nie może być większa niż zielonej.';
    if (form.name.trim().length > 200) errors.name = 'Najwyżej 200 znaków.';
    if (at && !errors.date) fields.roasted_at = at.toISOString();
    fields.roast_name = form.name.trim();
    if (typeof green === 'number') fields.green_g = gramsText(green);
    fields.roasted_g = typeof roasted === 'number' ? roastedGramsText(roasted) : '';
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, fields };
}
