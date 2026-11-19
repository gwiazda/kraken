import { describe, expect, it } from 'vitest';
import { productFromFields, type Product } from './model';
import { orderSaves } from './orderSaves';

// Made-up products.
const product = (id: string, position: string) => productFromFields({ id, name: id, position, updated_at: 'v1' }, 2);
const direct = <T>(work: () => Promise<T>) => work();

/** A fake sheet: writes take until released, one by one; `fail` makes the next write fail. */
function setup(list: Product[]) {
  let stored = list;
  const writes: string[][] = [];
  const release: (() => void)[] = [];
  let fail = false;
  const saves = orderSaves({
    stored: () => stored,
    write: async (changes) => {
      writes.push(changes.map((c) => `${c.product.id}=${c.position}`));
      await new Promise<void>((resolve) => release.push(resolve));
      if (fail) {
        fail = false;
        throw new Error('no internet');
      }
      return changes.map((c) => productFromFields({ ...c.product.source, position: String(c.position), updated_at: 'v2' }, c.product.row));
    },
    saved: (fresh) => {
      const byId = new Map(fresh.map((p) => [p.id, p]));
      stored = stored.map((p) => byId.get(p.id) ?? p);
    },
  });
  const next = async () => {
    for (let i = 0; i < 20 && release.length === 0; i++) await Promise.resolve();
    release.shift()?.();
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };
  return { saves, writes, next, stored: () => stored, failNext: () => (fail = true) };
}

describe('orderSaves', () => {
  it('saves one after another, each built on what the one before saved (only what changed)', async () => {
    const s = setup([product('A', '1'), product('B', '2'), product('C', '3')]);
    const first = s.saves.save(['C', 'A', 'B'], direct);
    const second = s.saves.save(['C', 'B', 'A'], direct);
    expect(s.saves.running).toBe(2);
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(s.writes).toEqual([['C=1', 'A=2', 'B=3']]); // the second waits while the first is running
    await s.next();
    expect(await first).toEqual({ kind: 'saved' });
    await s.next();
    expect(await second).toEqual({ kind: 'saved' });
    expect(s.writes).toEqual([
      ['C=1', 'A=2', 'B=3'],
      ['B=2', 'A=3'],
    ]);
    expect(s.stored().map((p) => [p.id, p.position, p.source['updated_at']])).toEqual([
      ['A', 3, 'v2'],
      ['B', 2, 'v2'],
      ['C', 1, 'v2'],
    ]);
    expect(s.saves.running).toBe(0);
    expect(await s.saves.idle()).toBe(true);
  });

  it('after a failure, skips the saves queued behind it (they would write a move no longer shown)', async () => {
    const s = setup([product('A', '1'), product('B', '2')]);
    s.failNext();
    const first = s.saves.save(['B', 'A'], direct);
    const second = s.saves.save(['A', 'B'], direct);
    await s.next();
    expect(await first).toEqual({ kind: 'failed', error: new Error('no internet') });
    expect(await second).toEqual({ kind: 'skipped' });
    expect(s.writes).toHaveLength(1);
    expect(await s.saves.idle()).toBe(false);
    // A new drag after that starts afresh.
    const third = s.saves.save(['B', 'A'], direct);
    await s.next();
    expect(await third).toEqual({ kind: 'saved' });
    expect(await s.saves.idle()).toBe(true);
  });

  it('a failure of the sign-in itself counts as a failed save', async () => {
    const s = setup([product('A', '1'), product('B', '2')]);
    const result = await s.saves.save(['B', 'A'], () => Promise.reject(new Error('popup blocked')));
    expect(result).toEqual({ kind: 'failed', error: new Error('popup blocked') });
    expect(s.writes).toEqual([]);
  });
});
