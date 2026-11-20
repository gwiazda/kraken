// The roasts part of "Sync with RoasTime". Pure, so every rule is tested. Rules agreed with the owner on 2026-11-15:
// - roasts are matched by RoasTime's roast ID; new ones are added (no choice per roast: the log should be complete)
// - a roast with no green weight is skipped and listed
// - a roast with no coffee chosen in RoasTime, or whose coffee has no delivery in RoasTime, is a sample and is not
//   tracked (owner, 2026-11-15): it is skipped, and one imported earlier is soft-deleted unless the owner touched it in
//   Kraken (chose a lot, marked a sample, own notes); a deleted roast that was a sample in Kraken and is a real roast
//   now (a coffee chosen, or the coffee's first delivery entered) is offered back (own tick box: the owner may have
//   deleted it by hand)
// - a roast changed in RoasTime (time, name, coffee, weights) is listed; one tick box updates them all
// - Kraken's own fields (lot, sample, notes) are never changed by a sync; an empty RoasTime value never empties Kraken's
// - a roast that is no longer in RoasTime stays in Kraken (only a note); other roasts deleted in Kraken are left alone

import { count } from '../../core/polish';
import { formatKg } from '../../core/numbers';
import { gramsText, parseGrams, parseRoastedGrams, roastTimeText, roastedGramsText, type Roast } from '../roasts';
import type { RoastimeRoast } from './model';

export interface NewRoast {
  readonly roastime: RoastimeRoast;
  readonly fields: Readonly<Record<string, string>>;
}

export interface ChangedRoast {
  readonly roast: Roast;
  readonly fields: Readonly<Record<string, string>>;
  /** What changed, one short sentence each, e.g. "Roasted weight: 1,02 kg → 1,03 kg". */
  readonly changes: readonly string[];
}

export interface RoastPlan {
  readonly added: readonly NewRoast[];
  readonly changed: readonly ChangedRoast[];
  readonly unchanged: number;
  /** Roasts not imported, with the reason, e.g. "Kenia 03.11 (2026-11-03): no green weight". */
  readonly skipped: readonly string[];
  /** Samples (no coffee, or a coffee with no delivery, in RoasTime), not tracked: not imported, or already deleted in Kraken. With the reason. */
  readonly samples: readonly string[];
  /** Samples imported earlier and untouched in Kraken: soft-deleted by the sync. */
  readonly removed: readonly Roast[];
  /** Samples kept because the owner gave them a lot, a sample mark or own notes in Kraken. */
  readonly keptSamples: readonly Roast[];
  /** Deleted samples that are real roasts now (a coffee chosen, or the coffee's first delivery): offered back, with the RoasTime changes. */
  readonly restored: readonly ChangedRoast[];
  /** Roasts in Kraken (from RoasTime) that are no longer in the RoasTime folder. Kept; only reported. */
  readonly goneFromRoastime: readonly Roast[];
  readonly problems: readonly string[];
}

const iso = (time: Date | null) => (time ? time.toISOString() : '');
/** Local date and time, like the Roasts page shows it. */
const when = (time: Date | null) => roastTimeText(time) || 'bez daty';

/** A stored weight as "1,2 kg" for the preview; a cell Kraken cannot read is shown as typed (never an error). */
function shownGrams(text: string, parse: (t: string) => number | null | undefined, toGrams: (n: number) => number): string {
  if (text === '') return '(puste)';
  const value = parse(text);
  return typeof value === 'number' ? formatKg(toGrams(value)) : `„${text}”`;
}
const greenShown = (text: string) => shownGrams(text, parseGrams, (n) => n);
const roastedShown = (text: string) => shownGrams(text, parseRoastedGrams, (n) => Math.round(n / 10));

/** The notes a sync writes for a new roast. */
const importedNotes = (rt: RoastimeRoast) => rt.comment.slice(0, 2000);

const sameText = (a: string, b: string) => a.replace(/\r\n?/g, '\n').trim() === b.replace(/\r\n?/g, '\n').trim();

/** True if the owner gave the roast something of their own in Kraken (then a sync never removes it). */
const touchedInKraken = (roast: Roast, rt: RoastimeRoast) => roast.lotId !== '' || roast.sample || !sameText(roast.notes, importedNotes(rt));

/** What RoasTime has that differs from the Kraken roast (never empties a Kraken value), and one sentence per change. */
function differences(existing: Roast, rt: RoastimeRoast, label: string, problems: string[]): { fields: Record<string, string>; changes: string[] } {
  const now = roastimeFields(rt);
  const fields: Record<string, string> = {};
  const changes: string[] = [];
  const offer = (column: string, describe: (from: string, to: string) => string) => {
    const from = (existing.source[column] ?? '').trim();
    const to = now[column] ?? '';
    if (to === '' || to === from) return; // never empty a Kraken value
    fields[column] = to;
    changes.push(describe(from, to));
  };
  offer('roasted_at', () => `Czas: ${when(existing.roastedAt)} → ${when(rt.roastedAt)}`);
  offer('roast_name', (from, to) => `Nazwa: ${from || '(puste)'} → ${to}`);
  if (rt.greenGrams === 0) problems.push(`RoasTime nie ma już wagi zielonej dla ${label}; Kraken zostawia swoją wartość.`);
  else offer('green_g', (from, to) => `Waga zielonej: ${greenShown(from)} → ${greenShown(to)}`);
  offer('roasted_g', (from, to) => `Waga palonej: ${roastedShown(from)} → ${roastedShown(to)}`);
  offer('roastime_bean_id', (from) => (from === '' ? 'Kawa: wybrana w RoasTime' : 'Kawa: w RoasTime wybrano inną kawę'));
  return { fields, changes };
}

/** The Kraken fields for a RoasTime roast (without Kraken's own fields). */
function roastimeFields(rt: RoastimeRoast): Record<string, string> {
  return {
    roasted_at: iso(rt.roastedAt),
    roast_name: rt.name,
    green_g: rt.greenGrams === null ? '' : gramsText(rt.greenGrams),
    roasted_g: rt.roastedDecigrams === null ? '' : roastedGramsText(rt.roastedDecigrams),
    roastime_bean_id: rt.beanId,
  };
}

/** Which RoasTime coffees (bean IDs) are real stock. */
export interface Coffees {
  /** Coffees with a delivery: a container in RoasTime (not deleted there) or a lot in Kraken that came from RoasTime. */
  readonly delivered: ReadonlySet<string>;
  /** Coffees that already had a lot in Kraken before this sync (deleted lots included). */
  readonly withLot: ReadonlySet<string>;
}

/**
 * The coffees for planRoasts, from the RoasTime folder and the lots in Kraken. A coffee with a lot in Kraken always
 * counts as delivered, so a delivery file missing from the folder (or one Kraken cannot read) never turns real roasts
 * into samples.
 */
export function coffeesOf(
  containers: readonly { beanId: string; deleted: boolean }[],
  lots: readonly { roastime: { beanId: string } }[],
): Coffees {
  const withLot = new Set(lots.map((l) => l.roastime.beanId).filter((id) => id !== ''));
  const inFolder = containers.filter((c) => !c.deleted && c.beanId !== '').map((c) => c.beanId);
  return { delivered: new Set([...withLot, ...inFolder]), withLot };
}

/** Why a RoasTime roast is a sample, or '' if it is a real roast. */
const sampleReason = (rt: RoastimeRoast, coffees: Coffees) =>
  rt.beanId === '' ? 'nie wybrano kawy' : coffees.delivered.has(rt.beanId) ? '' : 'jego kawa nie ma dostawy w RoasTime';

/**
 * True if a roast deleted in Kraken was a sample there (no coffee, or a coffee that had no lot): only such a roast is
 * offered back when it becomes real. One of a coffee with a lot was deleted for another reason, so it is left alone.
 */
const wasSample = (roast: Roast, coffees: Coffees) => roast.roastime.beanId === '' || !coffees.withLot.has(roast.roastime.beanId);

export function planRoasts(fromRoastime: readonly RoastimeRoast[], roasts: readonly Roast[], coffees: Coffees): RoastPlan {
  const problems: string[] = [];
  const byRoastimeId = new Map<string, Roast[]>();
  for (const roast of roasts) {
    if (roast.roastime.roastId === '') continue;
    byRoastimeId.set(roast.roastime.roastId, [...(byRoastimeId.get(roast.roastime.roastId) ?? []), roast]);
  }
  for (const group of byRoastimeId.values()) {
    if (group.filter((r) => r.deletedAt === '').length > 1) {
      problems.push(`${count(group.length, 'wypał', 'wypały', 'wypałów')} w Krakenie (wiersze ${group.map((r) => r.row).join(', ')}) to ten sam wypał RoasTime. Usuń nadmiarowe.`);
    }
  }

  const added: NewRoast[] = [];
  const changed: ChangedRoast[] = [];
  const skipped: string[] = [];
  const samples: string[] = [];
  const removed: Roast[] = [];
  const keptSamples: Roast[] = [];
  const restored: ChangedRoast[] = [];
  let unchanged = 0;
  const seen = new Set<string>();
  const ordered = [...fromRoastime].sort((a, b) => (a.roastedAt?.getTime() ?? 0) - (b.roastedAt?.getTime() ?? 0));

  for (const rt of ordered) {
    const label = `${rt.name || 'Wypał bez nazwy'} (${when(rt.roastedAt)})`;
    if (seen.has(rt.id)) {
      // The same roast twice in the folder (e.g. a Finder copy): use it once.
      problems.push(`${label} jest w folderze RoasTime dwa razy; Kraken bierze go raz.`);
      continue;
    }
    seen.add(rt.id);
    const group = byRoastimeId.get(rt.id) ?? [];
    const existing = group.find((r) => r.deletedAt === '') ?? group[0];
    const reason = sampleReason(rt, coffees);
    if (existing) {
      if (existing.deletedAt !== '') {
        // Deleted in Kraken: left alone, unless it was a sample and is a real roast now.
        if (reason !== '') samples.push(`${label}: ${reason}`);
        else if (wasSample(existing, coffees) && rt.greenGrams && rt.roastedAt !== null) {
          restored.push({ roast: existing, ...differences(existing, rt, label, problems) });
        }
        continue;
      }
      if (reason !== '') {
        // A sample: every active copy goes (a duplicate is reported above), unless the owner touched it in Kraken.
        for (const roast of group.filter((r) => r.deletedAt === '')) {
          if (touchedInKraken(roast, rt)) keptSamples.push(roast);
          else removed.push(roast);
        }
        // A kept one stays tracked, so it still gets RoasTime's changes below.
        if (!keptSamples.includes(existing)) continue;
      }
      const { fields, changes } = differences(existing, rt, label, problems);
      if (Object.keys(fields).length > 0) changed.push({ roast: existing, fields, changes });
      else unchanged++;
      continue;
    }
    if (rt.greenGrams === null || rt.greenGrams === 0) {
      skipped.push(`${label}: brak wagi zielonej`);
      continue;
    }
    if (rt.roastedAt === null) {
      skipped.push(`${label}: brak czasu wypału`);
      continue;
    }
    if (reason !== '') {
      samples.push(`${label}: ${reason}`);
      continue;
    }
    added.push({
      roastime: rt,
      fields: { ...roastimeFields(rt), roastime_roast_id: rt.id, lot_id: '', sample: '', notes: importedNotes(rt) },
    });
  }

  const goneFromRoastime = roasts.filter((r) => r.roastime.roastId !== '' && r.deletedAt === '' && !seen.has(r.roastime.roastId));
  return { added, changed, unchanged, skipped, samples, removed, keptSamples, restored, goneFromRoastime, problems };
}
