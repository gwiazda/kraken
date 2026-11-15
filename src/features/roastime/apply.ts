// Saves an import: all new lots in one request (so a big first import stays within Google's limits), then the
// updates one by one. Kept out of the screen so it is tested.

import type { LotsRepository } from '../lots';
import type { Operation } from './plan';

export interface ApplyDeps {
  repo: LotsRepository;
  whoAmI: () => Promise<string>;
  now: () => Date;
  onProgress: (text: string) => void;
}

/** The import stopped. `saved`: how many changes were certainly saved before the error. */
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

export interface ApplyResult {
  added: number;
  updated: number;
}

export async function applyImport(ops: readonly Operation[], deps: ApplyDeps): Promise<ApplyResult> {
  const adds = ops.filter((op) => op.kind === 'add');
  const updates = ops.filter((op) => op.kind === 'update');
  let saved = 0;
  try {
    if (adds.length > 0) {
      deps.onProgress(`Adding ${adds.length} new lot${adds.length === 1 ? '' : 's'}…`);
      await deps.repo.addMany(
        adds.map((op) => op.fields),
        await deps.whoAmI(),
        deps.now(),
      );
      saved += adds.length;
    }
    for (const op of updates) {
      deps.onProgress(`${op.label} (${saved - adds.length + 1} of ${updates.length} updates)…`);
      await deps.repo.update(op.lot, op.fields, deps.now());
      saved++;
    }
  } catch (error) {
    throw new ImportStopped(saved, ops.length, error);
  }
  return { added: adds.length, updated: updates.length };
}

/** "2 added, 1 updated" */
export function summaryOf(result: ApplyResult): string {
  return [
    [result.added, 'added'],
    [result.updated, 'updated'],
  ]
    .filter(([n]) => (n as number) > 0)
    .map(([n, word]) => `${n} ${word}`)
    .join(', ');
}
