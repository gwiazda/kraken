import { describe, expect, it } from 'vitest';
import { createKrakenSpreadsheet } from '../../schema';
import { fakeGoogleDrive } from '../../testing/fakeGoogleDrive';
import { lotFromFields, sheetLotsRepository } from '../lots';
import { ImportStopped, applyImport, summaryOf } from './apply';
import type { Operation } from './plan';

const now = new Date('2026-11-15T10:00:00.000Z');
const add = (code: string): Operation => ({ kind: 'add', label: `Add ${code}`, fields: { code, name: code, country: 'Kenya', delivery_date: '2026-11-03', quantity_kg: '60' } });

async function setup() {
  const google = fakeGoogleDrive();
  const info = await createKrakenSpreadsheet(google, now);
  const repo = sheetLotsRepository(google, info.id);
  return { google, repo };
}

describe('applyImport', () => {
  it('adds all new lots in one request, as the signed-in person', async () => {
    const { google, repo } = await setup();
    const progress: string[] = [];
    const result = await applyImport([add('A'), add('B'), add('C')], { repo, whoAmI: async () => 'owner@example.com', now: () => now, onProgress: (t) => progress.push(t) });
    expect(result).toEqual({ added: 3, updated: 0 });
    expect(google.requests.filter((r) => r.url.includes(':append'))).toHaveLength(1);
    const { lots } = await repo.load();
    expect(lots.map((l) => [l.code, l.createdBy])).toEqual([
      ['A', 'owner@example.com'],
      ['B', 'owner@example.com'],
      ['C', 'owner@example.com'],
    ]);
    expect(progress).toEqual(['Adding 3 new lots…']);
  });

  it('updates existing lots, and does not ask who is signed in when nothing is added', async () => {
    const { repo } = await setup();
    const [lot] = await repo.addMany([add('A').fields], 'me', now);
    if (!lot) throw new Error('no lot');
    const loaded = (await repo.load()).lots[0] ?? lot;
    let asked = false;
    const result = await applyImport([{ kind: 'update', lot: loaded, label: 'Update A', fields: { name: 'New name' } }], {
      repo,
      whoAmI: async () => {
        asked = true;
        return 'x';
      },
      now: () => now,
      onProgress: () => {},
    });
    expect(result).toEqual({ added: 0, updated: 1 });
    expect(asked).toBe(false);
    expect((await repo.load()).lots[0]?.name).toBe('New name');
  });

  it('says how many changes were saved when it stops', async () => {
    const { google, repo } = await setup();
    const stale = lotFromFields({ id: 'gone', code: 'X' }, 2);
    const ops: Operation[] = [add('A'), { kind: 'update', lot: stale, label: 'Update X', fields: { name: 'y' } }];
    const error = await applyImport(ops, { repo, whoAmI: async () => 'me', now: () => now, onProgress: () => {} }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ImportStopped);
    expect(error).toMatchObject({ saved: 1, total: 2 });

    google.failWhen.push(() => 500);
    const failed = await applyImport([add('B')], { repo, whoAmI: async () => 'me', now: () => now, onProgress: () => {} }).catch((e: unknown) => e);
    expect(failed).toMatchObject({ saved: 0, total: 1 });
  });
});

describe('summaryOf', () => {
  it('counts added and updated lots', () => {
    expect(summaryOf({ added: 2, updated: 1 })).toBe('2 added, 1 updated');
    expect(summaryOf({ added: 0, updated: 1 })).toBe('1 updated');
  });
});
