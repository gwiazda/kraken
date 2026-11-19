// Saving the products' order in the background (owner, 2026-11-20: no reload, page not locked). Each drag queues
// one save; saves run one after another, each built on the products as the one before saved them. When one fails,
// the saves queued behind it are skipped (the page goes back to the order last saved, so they must not write a
// move the owner no longer sees). No screen here, so it is tested on its own.

import { positionChanges, type Product } from './model';

/** What happened to one save. */
export type OrderSaveResult = { kind: 'saved' } | { kind: 'failed'; error: unknown } | { kind: 'skipped' };

export interface OrderSaves {
  /**
   * Queues saving `order` (product ids, first first). `run` wraps the work (the page passes withGoogle, called at
   * once inside the drop so a sign-in window may open).
   */
  save(order: readonly string[], run: <T>(work: () => Promise<T>) => Promise<T>): Promise<OrderSaveResult>;
  /** How many saves are queued or running. */
  readonly running: number;
  /** Resolves when every queued save is done: true if none of them failed. */
  idle(): Promise<boolean>;
}

export function orderSaves(options: {
  /** The products as last read from or saved to the sheet. */
  stored: () => readonly Product[];
  /** Writes the positions; gives the products as now stored. */
  write: (changes: { product: Product; position: number }[]) => Promise<Product[]>;
  /** A save worked: these products are now stored. */
  saved: (fresh: readonly Product[]) => void;
}): OrderSaves {
  let chain: Promise<unknown> = Promise.resolve();
  let running = 0;
  /** A save of the current batch failed: the rest of the batch is skipped. Cleared when a new batch starts. */
  let failed = false;
  return {
    get running() {
      return running;
    },
    save(order, run) {
      if (running === 0) failed = false;
      running++;
      const previous = chain;
      const result: Promise<OrderSaveResult> = run(async (): Promise<OrderSaveResult> => {
        await previous;
        if (failed) return { kind: 'skipped' };
        const fresh = await options.write(positionChanges(options.stored(), order));
        options.saved(fresh);
        return { kind: 'saved' };
      })
        .catch((error: unknown): OrderSaveResult => {
          failed = true;
          return { kind: 'failed', error };
        })
        .finally(() => {
          running--;
        });
      chain = result;
      return result;
    },
    idle: () => chain.then(() => !failed),
  };
}
