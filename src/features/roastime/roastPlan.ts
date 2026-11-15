// The roasts part of "Sync with RoasTime". Pure, so every rule is tested. Rules agreed with the owner on 2026-11-15:
// - roasts are matched by RoasTime's roast ID; new ones are added (no choice per roast: the log should be complete)
// - a roast with no green weight is skipped and listed
// - a roast changed in RoasTime (time, name, coffee, weights) is listed; one tick box updates them all
// - Kraken's own fields (lot, sample, notes) are never changed by a sync; an empty RoasTime value never empties Kraken's
// - a roast that is no longer in RoasTime stays in Kraken (only a note); roasts deleted in Kraken are left alone

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
  /** Roasts in Kraken (from RoasTime) that are no longer in the RoasTime folder. Kept; only reported. */
  readonly goneFromRoastime: readonly Roast[];
  readonly problems: readonly string[];
}

const iso = (time: Date | null) => (time ? time.toISOString() : '');
/** Local date and time, like the Roasts page shows it. */
const when = (time: Date | null) => roastTimeText(time) || 'no date';

/** A stored weight as "1,2 kg" for the preview; a cell Kraken cannot read is shown as typed (never an error). */
function shownGrams(text: string, parse: (t: string) => number | null | undefined, toGrams: (n: number) => number): string {
  if (text === '') return '(empty)';
  const value = parse(text);
  return typeof value === 'number' ? formatKg(toGrams(value)) : `"${text}"`;
}
const greenShown = (text: string) => shownGrams(text, parseGrams, (n) => n);
const roastedShown = (text: string) => shownGrams(text, parseRoastedGrams, (n) => Math.round(n / 10));

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

export function planRoasts(fromRoastime: readonly RoastimeRoast[], roasts: readonly Roast[]): RoastPlan {
  const problems: string[] = [];
  const byRoastimeId = new Map<string, Roast[]>();
  for (const roast of roasts) {
    if (roast.roastime.roastId === '') continue;
    byRoastimeId.set(roast.roastime.roastId, [...(byRoastimeId.get(roast.roastime.roastId) ?? []), roast]);
  }
  for (const group of byRoastimeId.values()) {
    if (group.filter((r) => r.deletedAt === '').length > 1) {
      problems.push(`${group.length} roasts in Kraken (rows ${group.map((r) => r.row).join(', ')}) are the same RoasTime roast. Delete the extra ones.`);
    }
  }

  const added: NewRoast[] = [];
  const changed: ChangedRoast[] = [];
  const skipped: string[] = [];
  let unchanged = 0;
  const seen = new Set<string>();
  const ordered = [...fromRoastime].sort((a, b) => (a.roastedAt?.getTime() ?? 0) - (b.roastedAt?.getTime() ?? 0));

  for (const rt of ordered) {
    const label = `${rt.name || 'Roast without a name'} (${when(rt.roastedAt)})`;
    if (seen.has(rt.id)) {
      // The same roast twice in the folder (e.g. a Finder copy): use it once.
      problems.push(`${label} is in the RoasTime folder twice; Kraken uses it once.`);
      continue;
    }
    seen.add(rt.id);
    const group = byRoastimeId.get(rt.id) ?? [];
    const existing = group.find((r) => r.deletedAt === '') ?? group[0];
    if (existing) {
      if (existing.deletedAt !== '') continue; // deleted in Kraken: left alone
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
      offer('roasted_at', () => `Time: ${when(existing.roastedAt)} → ${when(rt.roastedAt)}`);
      offer('roast_name', (from, to) => `Name: ${from || '(empty)'} → ${to}`);
      if (rt.greenGrams === 0) problems.push(`RoasTime now has no green weight for ${label}; Kraken keeps its value.`);
      else offer('green_g', (from, to) => `Green weight: ${greenShown(from)} → ${greenShown(to)}`);
      offer('roasted_g', (from, to) => `Roasted weight: ${roastedShown(from)} → ${roastedShown(to)}`);
      offer('roastime_bean_id', () => 'Coffee: a different coffee was chosen in RoasTime');
      if (Object.keys(fields).length > 0) changed.push({ roast: existing, fields, changes });
      else unchanged++;
      continue;
    }
    if (rt.greenGrams === null || rt.greenGrams === 0) {
      skipped.push(`${label}: no green weight`);
      continue;
    }
    if (rt.roastedAt === null) {
      skipped.push(`${label}: no roast time`);
      continue;
    }
    added.push({
      roastime: rt,
      fields: { ...roastimeFields(rt), roastime_roast_id: rt.id, lot_id: '', sample: '', notes: rt.comment.slice(0, 2000) },
    });
  }

  const goneFromRoastime = roasts.filter((r) => r.roastime.roastId !== '' && r.deletedAt === '' && !seen.has(r.roastime.roastId));
  return { added, changed, unchanged, skipped, goneFromRoastime, problems };
}
