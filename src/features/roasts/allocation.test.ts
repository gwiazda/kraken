import { describe, expect, it } from 'vitest';
import { lotFromFields } from '../lots';
import { allocate } from './allocation';
import { roastFromFields } from './model';

let n = 0;
const lot = (id: string, fields: Record<string, string> = {}) =>
  lotFromFields(
    { id, code: id.toUpperCase(), name: 'Kenya Kegwa', country: 'Kenya', delivery_date: '2026-09-01', quantity_kg: '10', roastime_bean_id: 'B1', roastime_container_id: `C-${id}`, deleted_at: '', ...fields },
    ++n,
  );
const roast = (id: string, grams: number, fields: Record<string, string> = {}) =>
  roastFromFields(
    { id, roasted_at: `2026-10-${String(10 + Number(id.replace(/\D/g, '') || 0)).padStart(2, '0')}T08:00:00.000Z`, green_g: String(grams), roasted_g: '', roastime_bean_id: 'B1', lot_id: '', sample: '', deleted_at: '', ...fields },
    ++n,
  );

describe('allocate: oldest lot first', () => {
  it('takes roasts from the oldest delivery of the coffee', () => {
    const result = allocate([lot('new', { delivery_date: '2026-10-01' }), lot('old', { delivery_date: '2026-09-01' })], [roast('r1', 1200)]);
    expect(result.roasts.get('r1')).toEqual({ status: 'automatic', parts: [{ lotId: 'old', grams: 1200 }], beforeDelivery: false });
    expect(result.lots.get('old')).toEqual({ usedGrams: 1200, leftGrams: 8800 });
    expect(result.lots.get('new')).toEqual({ usedGrams: 0, leftGrams: 10000 });
  });

  it('splits a roast when the oldest lot runs out, and goes on with the next one', () => {
    const lots = [lot('old', { quantity_kg: '2' }), lot('new', { delivery_date: '2026-09-15' })];
    const result = allocate(lots, [roast('r1', 1500), roast('r2', 1200)]);
    expect(result.roasts.get('r1')).toMatchObject({ parts: [{ lotId: 'old', grams: 1500 }] });
    expect(result.roasts.get('r2')).toMatchObject({ parts: [{ lotId: 'old', grams: 500 }, { lotId: 'new', grams: 700 }] });
    expect(result.lots.get('old')).toEqual({ usedGrams: 2000, leftGrams: 0 });
    expect(result.lots.get('new')).toEqual({ usedGrams: 700, leftGrams: 9300 });
  });

  it('goes by roast date, not by the order rows are in the sheet', () => {
    const lots = [lot('old', { quantity_kg: '1' }), lot('new', { delivery_date: '2026-09-15' })];
    const result = allocate(lots, [roast('r2', 1000), roast('r1', 1000)]); // r1 is earlier
    expect(result.roasts.get('r1')).toMatchObject({ parts: [{ lotId: 'old', grams: 1000 }] });
    expect(result.roasts.get('r2')).toMatchObject({ parts: [{ lotId: 'new', grams: 1000 }] });
  });

  it('shows below zero on the newest lot when more was roasted than delivered', () => {
    const lots = [lot('old', { quantity_kg: '1' }), lot('new', { delivery_date: '2026-09-15', quantity_kg: '1' })];
    const result = allocate(lots, [roast('r1', 2400)]);
    expect(result.roasts.get('r1')).toMatchObject({ parts: [{ lotId: 'old', grams: 1000 }, { lotId: 'new', grams: 1400 }] });
    expect(result.lots.get('new')).toEqual({ usedGrams: 1400, leftGrams: -400 });
  });

  it('only uses lots of the same coffee', () => {
    const result = allocate([lot('kenya'), lot('burundi', { roastime_bean_id: 'B2' })], [roast('r1', 1000, { roastime_bean_id: 'B2' })]);
    expect(result.roasts.get('r1')).toMatchObject({ parts: [{ lotId: 'burundi', grams: 1000 }] });
    expect(result.lots.get('kenya')?.usedGrams).toBe(0);
  });
});

describe('allocate: chosen lots', () => {
  it('uses the lot the owner chose, before the automatic ones take theirs', () => {
    const lots = [lot('old', { quantity_kg: '1' }), lot('new', { delivery_date: '2026-09-15' })];
    // r2 (later) was given lot "old" by hand: its kilograms are reserved, so r1 (earlier, automatic) goes to "new".
    const result = allocate(lots, [roast('r1', 1000), roast('r2', 1000, { lot_id: 'old' })]);
    expect(result.roasts.get('r2')).toEqual({ status: 'chosen', parts: [{ lotId: 'old', grams: 1000 }], beforeDelivery: false });
    expect(result.roasts.get('r1')).toMatchObject({ status: 'automatic', parts: [{ lotId: 'new', grams: 1000 }] });
  });

  it('lets a lot entered by hand be used only when chosen', () => {
    const hand = lot('hand', { roastime_bean_id: '', roastime_container_id: '' });
    expect(allocate([hand], [roast('r1', 1000)]).roasts.get('r1')).toEqual({ status: 'not-counted', reason: 'no-lot-for-coffee' });
    expect(allocate([hand], [roast('r1', 1000, { lot_id: 'hand' })]).lots.get('hand')).toEqual({ usedGrams: 1000, leftGrams: 9000 });
  });

  it('a chosen lot may go below zero', () => {
    const result = allocate([lot('small', { quantity_kg: '0.5' })], [roast('r1', 1000, { lot_id: 'small' })]);
    expect(result.lots.get('small')).toEqual({ usedGrams: 1000, leftGrams: -500 });
  });
});

describe('allocate: deleted and missing', () => {
  it('skips a deleted lot: its roasts move on to the next lot of the coffee', () => {
    const lots = [lot('old', { deleted_at: '2026-11-01T10:00:00.000Z' }), lot('new', { delivery_date: '2026-09-15' })];
    const result = allocate(lots, [roast('r1', 1000), roast('r2', 500, { lot_id: 'old' })]);
    expect(result.roasts.get('r1')).toMatchObject({ parts: [{ lotId: 'new', grams: 1000 }] });
    expect(result.roasts.get('r2')).toMatchObject({ status: 'automatic', parts: [{ lotId: 'new', grams: 500 }] });
    expect(result.lots.has('old')).toBe(false);
  });

  it('does not count deleted roasts', () => {
    const result = allocate([lot('a')], [roast('r1', 1000, { deleted_at: '2026-11-01T10:00:00.000Z' })]);
    expect(result.roasts.has('r1')).toBe(false);
    expect(result.lots.get('a')?.usedGrams).toBe(0);
  });

  it('does not count a roast without a coffee and without a chosen lot (samples too)', () => {
    const result = allocate([lot('a')], [roast('r1', 150, { roastime_bean_id: '', sample: 'yes' }), roast('r2', 1000, { roastime_bean_id: '' })]);
    expect(result.roasts.get('r1')).toEqual({ status: 'not-counted', reason: 'no-coffee' });
    expect(result.roasts.get('r2')).toEqual({ status: 'not-counted', reason: 'no-coffee' });
    expect(result.lots.get('a')?.usedGrams).toBe(0);
  });

  it('counts a sample that has a coffee (owner, 2026-11-15)', () => {
    expect(allocate([lot('a')], [roast('r1', 150, { sample: 'yes' })]).lots.get('a')?.usedGrams).toBe(150);
  });

  it('does not count a roast without a green weight', () => {
    expect(allocate([lot('a')], [roast('r1', 0)]).roasts.get('r1')).toEqual({ status: 'not-counted', reason: 'no-green-weight' });
    expect(allocate([lot('a')], [roast('r1', 1, { green_g: 'abc' })]).roasts.get('r1')).toEqual({ status: 'not-counted', reason: 'no-green-weight' });
  });

  it('shows no stock left for a lot whose delivered kg is unknown', () => {
    expect(allocate([lot('a', { quantity_kg: '' })], []).lots.get('a')).toEqual({ usedGrams: 0, leftGrams: null });
  });

  it('keeps the oldest-first order when the oldest lot has no delivered kg (its roasts are not pushed onto newer lots)', () => {
    const lots = [lot('old', { quantity_kg: '' }), lot('new', { delivery_date: '2026-09-15' })];
    const result = allocate(lots, [roast('r1', 1000), roast('r2', 500)]);
    expect(result.lots.get('old')).toEqual({ usedGrams: 1500, leftGrams: null });
    expect(result.lots.get('new')).toEqual({ usedGrams: 0, leftGrams: 10000 });
  });
});

describe('allocate: roasted before delivery', () => {
  it('flags a roast dated before the delivery of a lot it uses', () => {
    const result = allocate([lot('late', { delivery_date: '2026-12-01' })], [roast('r1', 1000)]);
    expect(result.roasts.get('r1')).toMatchObject({ status: 'automatic', beforeDelivery: true });
  });

  it('does not flag a roast on the delivery day', () => {
    const result = allocate([lot('a', { delivery_date: '2026-10-11' })], [roast('r1', 1000)]); // r1 is 2026-10-11 08:00Z
    expect(result.roasts.get('r1')).toMatchObject({ beforeDelivery: false });
  });
});
