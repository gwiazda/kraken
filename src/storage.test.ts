import { describe, expect, it } from 'vitest';
import { forgetSpreadsheetId, isValidSpreadsheetId, loadSpreadsheetId, saveSpreadsheetId, type KeyValueStore } from './storage';

const ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz_0123456789-ab'; // made up

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

const blockedStore: KeyValueStore = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
  removeItem: () => {
    throw new Error('blocked');
  },
};

describe('spreadsheet ID storage', () => {
  it('saves, loads and forgets the ID', () => {
    const store = memoryStore();
    expect(loadSpreadsheetId(store)).toBeNull();
    expect(saveSpreadsheetId(store, ID)).toBe(true);
    expect(loadSpreadsheetId(store)).toBe(ID);
    forgetSpreadsheetId(store);
    expect(loadSpreadsheetId(store)).toBeNull();
  });

  it('stores nothing but the ID', () => {
    const store = memoryStore();
    saveSpreadsheetId(store, ID);
    expect([...store.data.values()]).toEqual([ID]);
  });

  it('ignores a corrupted stored value', () => {
    const store = memoryStore();
    store.data.set('kraken.spreadsheetId', '<script>alert(1)</script>');
    expect(loadSpreadsheetId(store)).toBeNull();
  });

  it('refuses to save an invalid ID', () => {
    expect(() => saveSpreadsheetId(memoryStore(), 'not an id')).toThrow();
  });

  it('keeps working when the browser blocks storage', () => {
    expect(loadSpreadsheetId(blockedStore)).toBeNull();
    expect(saveSpreadsheetId(blockedStore, ID)).toBe(false);
    expect(() => forgetSpreadsheetId(blockedStore)).not.toThrow();
  });

  it('keeps working when there is no storage at all', () => {
    expect(loadSpreadsheetId(undefined)).toBeNull();
    expect(saveSpreadsheetId(undefined, ID)).toBe(false);
    expect(() => forgetSpreadsheetId(undefined)).not.toThrow();
  });
});

describe('isValidSpreadsheetId', () => {
  it.each([
    [ID, true],
    ['short', false],
    ['has spaces in it which are not allowed', false],
    ['../../etc/passwd/aaaaaaaaaaaaaaaaaa', false],
    ['', false],
  ])('%s -> %s', (id, valid) => {
    expect(isValidSpreadsheetId(id)).toBe(valid);
  });
});
