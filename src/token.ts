// Holds the Google access token in memory only (never in browser storage), with its expiry time.

/** Treat the token as expired this long before Google's expiry, so a request never starts with a dying token. */
export const EXPIRY_MARGIN_MS = 60_000;

export class TokenHolder {
  private token: string | null = null;
  private expiresAt = 0;

  /** Stores a token from Google. `expiresInSeconds` comes from Google's response (usually 3599). */
  set(token: string, expiresInSeconds: number, now: number = Date.now()): void {
    if (!token) throw new Error('Empty access token');
    const seconds = Number.isFinite(expiresInSeconds) && expiresInSeconds > 0 ? expiresInSeconds : 0;
    this.token = token;
    this.expiresAt = now + seconds * 1000;
  }

  /** The token if it is still valid, otherwise null. */
  get(now: number = Date.now()): string | null {
    if (this.token === null || now >= this.expiresAt - EXPIRY_MARGIN_MS) return null;
    return this.token;
  }

  /** The raw token even if expired (only for revoking it at sign-out). */
  peek(): string | null {
    return this.token;
  }

  clear(): void {
    this.token = null;
    this.expiresAt = 0;
  }
}
