// A fake Google Sheets API for tests: records every request and answers from a list of prepared responses.

import type { SheetsClient } from '../sheets';

export interface RecordedRequest {
  url: string;
  method: string;
  headers: Headers;
  body: unknown;
}

export interface FakeReply {
  status?: number;
  body?: unknown;
}

export function fakeClient(replies: FakeReply[], token = 'test-token'): SheetsClient & { requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  const queue = [...replies];
  return {
    requests,
    getToken: () => token,
    fetch: async (url, init = {}) => {
      requests.push({
        url,
        method: init.method ?? 'GET',
        headers: new Headers(init.headers),
        body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
      });
      const reply = queue.shift();
      if (!reply) throw new Error(`Unexpected request: ${url}`);
      const status = reply.status ?? 200;
      return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  };
}
