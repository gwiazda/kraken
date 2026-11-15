import { describe, expect, it, vi } from 'vitest';
import { makeGuard } from './session';
import { SignInSuperseded } from './signInFlow';
import type { TokenStatus } from './token';

function setup(status: TokenStatus, renewResult: Promise<void> = Promise.resolve()) {
  const renew = vi.fn(() => renewResult);
  const action = vi.fn(async () => 'done');
  const guard = makeGuard({ status: () => status, renew });
  return { renew, action, guard };
}

describe('guard (renew on the next click)', () => {
  it('runs the action straight away when the token is valid, without a popup', async () => {
    const { renew, action, guard } = setup('valid');
    await expect(guard(action)).resolves.toBe('done');
    expect(renew).not.toHaveBeenCalled();
    expect(action).toHaveBeenCalledOnce();
  });

  it.each(['renew', 'none'] as const)('gets a fresh token first when the status is "%s"', async (status) => {
    const { renew, action, guard } = setup(status);
    await expect(guard(action)).resolves.toBe('done');
    expect(renew).toHaveBeenCalledOnce();
    expect(renew.mock.invocationCallOrder[0]).toBeLessThan(action.mock.invocationCallOrder[0] ?? 0);
  });

  it('opens the popup synchronously, inside the click (otherwise Chrome blocks it)', () => {
    const { renew, action, guard } = setup('renew');
    void guard(action);
    expect(renew).toHaveBeenCalledOnce(); // checked before any await
    expect(action).not.toHaveBeenCalled();
  });

  it('does not run the action when renewal fails (for example the popup was closed)', async () => {
    const { action, guard } = setup('none', Promise.reject(new Error('Sign-in window was closed.')));
    await expect(guard(action)).rejects.toThrow('closed');
    expect(action).not.toHaveBeenCalled();
  });

  it('still runs the action with the old pass when renewal fails but the old pass has minutes left', async () => {
    const { action, guard } = setup('renew', Promise.reject(new Error('Chrome blocked the window')));
    await expect(guard(action)).resolves.toBe('done');
    expect(action).toHaveBeenCalledOnce();
  });

  it('does not run the action when the renewal was replaced by a newer attempt', async () => {
    const { action, guard } = setup('renew', Promise.reject(new SignInSuperseded()));
    await expect(guard(action)).rejects.toBeInstanceOf(SignInSuperseded);
    expect(action).not.toHaveBeenCalled();
  });

  it('does not run the action when renewal fails and the old pass has run out meanwhile', async () => {
    let status: 'renew' | 'none' = 'renew';
    const action = vi.fn(async () => 'done');
    const guard = makeGuard({
      status: () => status,
      renew: () => {
        status = 'none';
        return Promise.reject(new Error('closed'));
      },
    });
    await expect(guard(action)).rejects.toThrow('closed');
    expect(action).not.toHaveBeenCalled();
  });
});
