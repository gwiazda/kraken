// Saves a sync: new lots in one request, lot updates in one, new roasts in one, roast updates in one. So even a
// first sync of hundreds of roasts stays within Google's limits. Lots first, because roasts are counted against them.
// Kept out of the screen so it is tested.

import type { LotsRepository } from '../lots';
import type { Roast, RoastsRepository } from '../roasts';
import type { Operation } from './plan';

type Fields = Readonly<Record<string, string>>;

export interface SyncWrites {
  readonly lotOps: readonly Operation[];
  readonly roastAdds: readonly Fields[];
  readonly roastUpdates: readonly { roast: Roast; fields: Fields }[];
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

export const changeCount = (writes: SyncWrites) => writes.lotOps.length + writes.roastAdds.length + writes.roastUpdates.length;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export async function applySync(writes: SyncWrites, deps: ApplyDeps): Promise<SyncResult> {
  const lotAdds = writes.lotOps.filter((op) => op.kind === 'add');
  const lotUpdates = writes.lotOps.filter((op) => op.kind === 'update');
  const total = changeCount(writes);
  let saved = 0;
  try {
    const by = lotAdds.length + writes.roastAdds.length > 0 ? await deps.whoAmI() : '';
    if (lotAdds.length > 0) {
      deps.onProgress(`Adding ${plural(lotAdds.length, 'new lot')}…`);
      await deps.lots.addMany(lotAdds.map((op) => op.fields), by, deps.now());
      saved += lotAdds.length;
    }
    if (lotUpdates.length > 0) {
      deps.onProgress(`Updating ${plural(lotUpdates.length, 'lot')}…`);
      await deps.lots.updateMany(lotUpdates.map((op) => ({ lot: op.lot, fields: op.fields })), deps.now());
      saved += lotUpdates.length;
    }
    if (writes.roastAdds.length > 0) {
      deps.onProgress(`Adding ${plural(writes.roastAdds.length, 'roast')}…`);
      await deps.roasts.addMany(writes.roastAdds, by, deps.now());
      saved += writes.roastAdds.length;
    }
    if (writes.roastUpdates.length > 0) {
      deps.onProgress(`Updating ${plural(writes.roastUpdates.length, 'roast')}…`);
      await deps.roasts.updateMany(writes.roastUpdates, deps.now());
      saved += writes.roastUpdates.length;
    }
  } catch (error) {
    throw new ImportStopped(saved, total, error);
  }
  return { lotsAdded: lotAdds.length, lotsUpdated: lotUpdates.length, roastsAdded: writes.roastAdds.length, roastsUpdated: writes.roastUpdates.length };
}

/** "2 lots added, 38 roasts added, 3 roasts updated" */
export function summaryOf(result: SyncResult): string {
  const parts = [
    result.lotsAdded > 0 ? `${plural(result.lotsAdded, 'lot')} added` : '',
    result.lotsUpdated > 0 ? `${plural(result.lotsUpdated, 'lot')} updated` : '',
    result.roastsAdded > 0 ? `${plural(result.roastsAdded, 'roast')} added` : '',
    result.roastsUpdated > 0 ? `${plural(result.roastsUpdated, 'roast')} updated` : '',
  ].filter((p) => p !== '');
  return parts.length > 0 ? parts.join(', ') : 'nothing changed';
}
