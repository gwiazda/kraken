import { describe, expect, it } from 'vitest';
import { createKrakenSpreadsheet } from '../../schema';
import { fakeGoogleDrive } from '../../testing/fakeGoogleDrive';
import { linesOf, statusChange } from './model';
import { sheetSalesRepository } from './repo';

const now = new Date('2026-11-19T10:00:00.000Z');
const later = new Date('2026-11-19T11:00:00.000Z');
const line = (position: string, bags: string) => ({ position, product_id: 'P1', bag_size_g: '1000', bags, unit_price_net_pln: '97.02', free: '' });

describe('sheetSalesRepository (in-memory Google)', () => {
  it('adds a sale with its lines, edits the lines, marks it issued and paid, and soft-deletes it', async () => {
    const google = fakeGoogleDrive();
    const info = await createKrakenSpreadsheet(google, now);
    const repo = sheetSalesRepository(google, info.id);
    expect(await repo.load()).toEqual({ sales: [], lines: [], problems: [] });

    const id = await repo.add({ date: '2026-11-19', kind: 'sale', client_id: 'C1', invoice_status: 'to_issue' }, [line('1', '3'), line('2', '1')], 'partner@example.com', now);
    let data = await repo.load();
    expect(data.sales).toHaveLength(1);
    expect(data.sales[0]).toMatchObject({ id, status: 'to_issue', createdBy: 'partner@example.com' });
    expect(linesOf(data.lines, id).map((l) => [l.position, l.bags])).toEqual([
      [1, 3],
      [2, 1],
    ]);

    await repo.saveLines(id, [line('1', '4')], linesOf(data.lines, id), async () => 'x', later);
    data = await repo.load();
    expect(linesOf(data.lines, id).map((l) => l.bags)).toEqual([4]);

    const issued = statusChange('issued', { invoiceDate: '2026-11-20', invoiceNumber: 'FV 1/11/2026' });
    if (!issued.ok) throw new Error('setup');
    let [sale] = data.sales;
    if (!sale) throw new Error('setup');
    await repo.update(sale, issued.fields, later);
    data = await repo.load();
    [sale] = data.sales;
    if (!sale) throw new Error('setup');
    expect(sale).toMatchObject({ status: 'issued', invoiceDate: '2026-11-20', invoiceNumber: 'FV 1/11/2026' });

    await repo.remove(sale, later);
    expect((await repo.load()).sales[0]?.deletedAt).toBe(later.toISOString());
  });
});
