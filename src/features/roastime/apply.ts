// Saves a sync: new lots in one request, lot updates in one, new roasts in one, roast edits (updates, removals, restores) in one. So even a
// first sync of hundreds of roasts stays within Google's limits. Lots first, because roasts are counted against them.
// Kept out of the screen so it is tested.

import type { LotsRepository } from '../lots';
import { roastsCount, type Roast, type RoastsRepository } from '../roasts';
import type { Operation } from './plan';
import { count } from '../../core/polish';

type Fields = Readonly<Record<string, string>>;

export interface SyncWrites {
  readonly lotOps: readonly Operation[];
  readonly roastAdds: readonly Fields[];
  readonly roastUpdates: readonly { roast: Roast; fields: Fields }[];
  /** Samples (no coffee, or a coffee with no delivery, in RoasTime) to soft-delete. */
  readonly roastRemovals: readonly Roast[];
  /** Roasts to bring back, with the RoasTime fields that changed. */
  readonly roastRestores: readonly { roast: Roast; fields: Fields }[];
}

export interface ApplyDeps {
  lots: LotsRepository;
  roasts: RoastsRepository;
  whoAmI: () => Promise<string>;
  now: () => Date;
  onProgress: (text: string) => void;
}

export interface SyncResult {
  lotsAdded: number;
  lotsUpdated: number;
  roastsAdded: number;
  roastsUpdated: number;
  roastsRemoved: number;
  roastsRestored: number;
}

/** The sync stopped. `saved`: how many changes were certainly saved before the error. */
export class ImportStopped extends Error {
  readonly saved: number;
  readonly total: number;
  readonly cause: unknown;
  constructor(saved: number, total: number, cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = 'ImportStopped';
    this.saved = saved;
    this.total = total;
    this.cause = cause;
  }
}

export const changeCount = (writes: SyncWrites) =>
  writes.lotOps.length + writes.roastAdds.length + writes.roastUpdates.length + writes.roastRemovals.length + writes.roastRestores.length;

/** "1 dostawę", "2 dostawy", "5 dostaw" (after "dodano", "zaktualizowano"). */
const lotsCount = (n: number) => count(n, 'dostawę', 'dostawy', 'dostaw');

export async function applySync(writes: SyncWrites, deps: ApplyDeps): Promise<SyncResult> {
  const lotAdds = writes.lotOps.filter((op) => op.kind === 'add');
  const lotUpdates = writes.lotOps.filter((op) => op.kind === 'update');
  const total = changeCount(writes);
  let saved = 0;
  try {
    const by = lotAdds.length + writes.roastAdds.length > 0 ? await deps.whoAmI() : '';
    if (lotAdds.length > 0) {
      deps.onProgress(`Dodaję ${count(lotAdds.length, 'nową dostawę', 'nowe dostawy', 'nowych dostaw')}…`);
      await deps.lots.addMany(lotAdds.map((op) => op.fields), by, deps.now());
      saved += lotAdds.length;
    }
    if (lotUpdates.length > 0) {
      deps.onProgress(`Aktualizuję ${lotsCount(lotUpdates.length)}…`);
      await deps.lots.updateMany(lotUpdates.map((op) => ({ lot: op.lot, fields: op.fields })), deps.now());
      saved += lotUpdates.length;
    }
    if (writes.roastAdds.length > 0) {
      deps.onProgress(`Dodaję ${roastsCount(writes.roastAdds.length)}…`);
      await deps.roasts.addMany(writes.roastAdds, by, deps.now());
      saved += writes.roastAdds.length;
    }
    // Updates, removals and restores are all edits of existing rows: one request (all or none).
    const edits = [
      ...writes.roastUpdates,
      ...writes.roastRestores.map((r) => ({ ...r, deleted: false })),
      ...writes.roastRemovals.map((roast) => ({ roast, fields: {}, deleted: true })),
    ];
    if (edits.length > 0) {
      deps.onProgress(`Aktualizuję ${roastsCount(edits.length)}…`);
      await deps.roasts.updateMany(edits, deps.now());
      saved += edits.length;
    }
  } catch (error) {
    throw new ImportStopped(saved, total, error);
  }
  return {
    lotsAdded: lotAdds.length,
    lotsUpdated: lotUpdates.length,
    roastsAdded: writes.roastAdds.length,
    roastsUpdated: writes.roastUpdates.length,
    roastsRemoved: writes.roastRemovals.length,
    roastsRestored: writes.roastRestores.length,
  };
}

/** "dodano 2 dostawy, dodano 38 wypałów, zaktualizowano 3 wypały" */
export function summaryOf(result: SyncResult): string {
  const parts = [
    result.lotsAdded > 0 ? `dodano ${lotsCount(result.lotsAdded)}` : '',
    result.lotsUpdated > 0 ? `zaktualizowano ${lotsCount(result.lotsUpdated)}` : '',
    result.roastsAdded > 0 ? `dodano ${roastsCount(result.roastsAdded)}` : '',
    result.roastsUpdated > 0 ? `zaktualizowano ${roastsCount(result.roastsUpdated)}` : '',
    result.roastsRemoved > 0 ? `usunięto ${count(result.roastsRemoved, 'próbkę', 'próbki', 'próbek')}` : '',
    result.roastsRestored > 0 ? `przywrócono ${roastsCount(result.roastsRestored)}` : '',
  ].filter((p) => p !== '');
  return parts.length > 0 ? parts.join(', ') : 'nic się nie zmieniło';
}
