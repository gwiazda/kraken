import { describe, expect, it, vi } from 'vitest';
import { MISSING_SCOPE_MESSAGE, SignInFlow } from './signInFlow';
import { TokenHolder } from './token';

function setup() {
  const tokens = new TokenHolder();
  const flow = new SignInFlow(tokens);
  const late = vi.fn();
  flow.onLateReply(late);
  const request = vi.fn();
  return { tokens, flow, late, request };
}

const goodReply = { access_token: 'tok', expires_in: 3599 };

describe('SignInFlow', () => {
  it('opens Google\'s popup synchronously, inside the click', () => {
    const { flow, request } = setup();
    void flow.start(request);
    expect(request).toHaveBeenCalledOnce();
  });

  it('resolves and stores the token when Google sends it', async () => {
    const { flow, tokens, late, request } = setup();
    const result = flow.start(request);
    flow.handleToken(goodReply, true);
    await expect(result).resolves.toBeUndefined();
    expect(tokens.get()).toBe('tok');
    expect(late).not.toHaveBeenCalled();
  });

  it('keeps a token that arrives after Google wrongly reported the popup as closed, and moves the app forward', async () => {
    const { flow, tokens, late, request } = setup();
    const result = flow.start(request);
    flow.handlePopupError('popup_closed');
    await expect(result).rejects.toThrow('second click');

    flow.handleToken(goodReply, true); // the token Google delivers a moment later
    expect(tokens.get()).toBe('tok');
    expect(late).toHaveBeenCalledWith({ ok: true });
  });

  it('reports a late reply without the Drive permission, instead of staying silent', async () => {
    const { flow, tokens, late, request } = setup();
    const result = flow.start(request);
    flow.handlePopupError('popup_closed');
    await expect(result).rejects.toThrow('second click');

    flow.handleToken(goodReply, false);
    expect(tokens.get()).toBeNull();
    expect(late).toHaveBeenCalledWith({ ok: false, error: new Error(MISSING_SCOPE_MESSAGE) });
  });

  it('writes each step to the log, but never the pass itself', async () => {
    const tokens = new TokenHolder();
    const log = vi.fn();
    const flow = new SignInFlow(tokens, log);
    const result = flow.start(() => {});
    flow.handleToken({ access_token: 'secret-token-value', expires_in: 3599 }, true);
    await result;
    const lines = log.mock.calls.map((call) => String(call[0]));
    expect(lines).toEqual(['Kraken asked Google to open the sign-in window', 'Google sent a pass with the Drive permission']);
    expect(lines.join(' ')).not.toContain('secret-token-value');
  });

  it('explains what to do when the Drive permission box was not ticked, and stores nothing', async () => {
    const { flow, tokens, late, request } = setup();
    const result = flow.start(request);
    flow.handleToken(goodReply, false);
    await expect(result).rejects.toThrow(MISSING_SCOPE_MESSAGE);
    expect(tokens.get()).toBeNull();
    expect(late).not.toHaveBeenCalled();
  });

  it('does not store a token when Google reports an error', async () => {
    const { flow, tokens, request } = setup();
    const result = flow.start(request);
    flow.handleToken({ error: 'access_denied' }, true);
    await expect(result).rejects.toThrow('access_denied');
    expect(tokens.get()).toBeNull();
  });

  it('cancels an older sign-in attempt when a new one starts', async () => {
    const { flow, request } = setup();
    const first = flow.start(request);
    const second = flow.start(request);
    await expect(first).rejects.toThrow('restarted');
    flow.handleToken(goodReply, true);
    await expect(second).resolves.toBeUndefined();
  });

  it.each([
    ['popup_closed', 'Google needs a second click'],
    ['popup_failed_to_open', 'blocked'],
    ['unknown', 'unknown'],
  ])('explains popup error %s', async (type, text) => {
    const { flow, request } = setup();
    const result = flow.start(request);
    flow.handlePopupError(type);
    await expect(result).rejects.toThrow(text);
  });
});
