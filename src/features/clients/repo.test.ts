import { describe, expect, it } from 'vitest';
import { createKrakenSpreadsheet } from '../../schema';
import { fakeGoogleDrive } from '../../testing/fakeGoogleDrive';
import { sheetClientsRepository } from './repo';

const now = new Date('2026-11-19T10:00:00.000Z');
const later = new Date('2026-11-19T11:00:00.000Z');

describe('sheetClientsRepository (in-memory Google)', () => {
  it('adds, edits, soft-deletes and restores a client', async () => {
    const google = fakeGoogleDrive();
    const info = await createKrakenSpreadsheet(google, now);
    const repo = sheetClientsRepository(google, info.id);
    expect(await repo.load()).toEqual({ clients: [], problems: [] });

    await repo.add({ name: 'Café Nowa', nip: '9876543210', email: 'kawa@example.com', registered_name: '', discount_percent: '15' }, 'owner@example.com', now);
    let [c] = (await repo.load()).clients;
    if (!c) throw new Error('setup');
    expect(c).toMatchObject({ name: 'Café Nowa', discountTenths: 150 });

    await repo.update(c, { discount_percent: '25' }, later);
    [c] = (await repo.load()).clients;
    if (!c) throw new Error('setup');
    expect(c.discountTenths).toBe(250);

    await repo.remove(c, later);
    [c] = (await repo.load()).clients;
    if (!c) throw new Error('setup');
    expect(c.deletedAt).toBe(later.toISOString());
    await repo.restore(c, later);
    expect((await repo.load()).clients[0]?.deletedAt).toBe('');
  });
});
