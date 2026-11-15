import { describe, expect, it } from 'vitest';
import { fakeClient } from '../testing/fakeGoogle';
import { copyFile, whoAmI } from './drive';

describe('whoAmI', () => {
  it("asks Drive for only the signed-in person's email", async () => {
    const client = fakeClient([{ body: { user: { emailAddress: 'owner@example.com' } } }]);
    expect(await whoAmI(client)).toBe('owner@example.com');
    expect(client.requests[0]?.url).toBe('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)');
    expect(client.requests[0]?.headers.get('Authorization')).toBe('Bearer test-token');
  });

  it.each([{}, { user: {} }, { user: { emailAddress: '' } }, { user: { emailAddress: 42 } }])('refuses a reply without an email: %j', async (body) => {
    await expect(whoAmI(fakeClient([{ body }]))).rejects.toThrow('did not say who is signed in');
  });

  it('passes Google errors on', async () => {
    await expect(whoAmI(fakeClient([{ status: 401, body: {} }]))).rejects.toMatchObject({ kind: 'signed-out' });
  });
});

describe('copyFile', () => {
  it('copies with the given name and returns the new ID', async () => {
    const client = fakeClient([{ body: { id: 'copy-1' } }]);
    expect(await copyFile(client, 'orig-1', 'Kraken backup')).toBe('copy-1');
    expect(client.requests[0]).toMatchObject({ method: 'POST', body: { name: 'Kraken backup' } });
    expect(client.requests[0]?.url).toBe('https://www.googleapis.com/drive/v3/files/orig-1/copy?fields=id');
  });

  it('refuses a reply without an ID', async () => {
    await expect(copyFile(fakeClient([{ body: {} }]), 'orig-1', 'x')).rejects.toThrow('did not return the ID');
  });
});
