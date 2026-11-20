import { describe, expect, it } from 'vitest';
import { lotFromFields } from '../lots';
import { loadPlannerData } from './planner';

const lot = lotFromFields({ id: 'L1', code: 'KENYA-26-09', name: 'Kegwa', country: 'Kenya', delivery_date: '2026-09-08', quantity_kg: '60', coffee_price_net_pln: '4500', delivery_cost_net_pln: '120' }, 2);
const signedOut = new Error('signed out');
const superseded = new Error('superseded');
const sources = (costs: () => Promise<unknown>) => ({
  costs: { load: costs } as never,
  lots: { load: async () => ({ lots: [lot], problems: [] }) } as never,
  roasts: { load: async () => ({ roasts: [], problems: [] }) } as never,
  isSignedOut: (e: unknown) => e === signedOut,
  isIgnorable: (e: unknown) => e === superseded,
  describeError: (e: unknown) => (e instanceof Error ? e.message : String(e)),
});

describe('loadPlannerData', () => {
  it('gives every lot as a bean, the packaging per size, VAT, discounts and the problems found', async () => {
    const data = await loadPlannerData(sources(async () => ({ settings: [], costs: [], lotCosts: [], discounts: [], problems: ['Row 7 of Bag costs cannot be read.'] })));
    expect(data.beanLots.map((l) => [l.label, l.greenPerKg])).toEqual([['KENYA-26-09 · Kegwa', 7700]]);
    expect(data.settings.vatTenths).toBe(230);
    expect(data.discounts.map((d) => d.tenths)).toEqual([150, 250, 300]);
    expect([...data.packaging.keys()]).toEqual([250, 500, 1000]);
    expect(data.problems).toEqual(['Row 7 of Bag costs cannot be read.']);
  });

  it('still opens with the defaults when the data cannot be read, and says why', async () => {
    const data = await loadPlannerData(
      sources(async () => {
        throw new Error('Google is busy');
      }),
    );
    expect(data.beanLots).toEqual([]);
    expect(data.settings.vatTenths).toBe(230);
    expect(data.problems).toEqual(['Nie udało się wczytać opakowań, rabatów i dostaw (Google is busy); używane są domyślne VAT i rabaty.']);
  });

  it('passes on a signed-out or superseded sign-in (so the page can ask to sign in)', async () => {
    for (const error of [signedOut, superseded]) {
      await expect(
        loadPlannerData(
          sources(async () => {
            throw error;
          }),
        ),
      ).rejects.toBe(error);
    }
  });
});
