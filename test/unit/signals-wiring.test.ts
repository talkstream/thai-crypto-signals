import { describe, expect, it } from 'vitest';
import type { SignalJob } from '../../src/signals/types';
import { buildNotifier } from '../../src/signals/wiring';
import { InMemoryObservabilitySink, recordingFetcher } from '../helpers/fakes';

const JOB: SignalJob = { bucketTs: 1, symbols: ['BTC_THB'], producedAt: 2, schemaVersion: 1 };

// Only the secret fields matter to buildNotifier; cast a partial object to Env (the real bindings are
// irrelevant here). No mock: delivery goes through an injected recording Fetcher.
function envWith(secrets: Partial<Record<string, string>>): Env {
  return secrets as unknown as Env;
}

describe('buildNotifier', () => {
  it('activates all three channels when every secret is present', async () => {
    const urls: string[] = [];
    const f = recordingFetcher((url) => {
      urls.push(url);
      return Response.json({});
    });
    const env = envWith({
      TELEGRAM_BOT_TOKEN: 'tg',
      TELEGRAM_CHAT_ID: '775707',
      LINE_CHANNEL_ACCESS_TOKEN: 'ln',
      LINE_TARGET_ID: 'Uxyz',
      WEBHOOK_URL: 'https://hook.test/x',
      WEBHOOK_SIGNING_SECRET: 'sek',
    });
    const r = await buildNotifier(f.fetcher, env, new InMemoryObservabilitySink()).deliver(JOB);

    expect(r.delivered).toBe(3);
    expect(urls.some((u) => u.includes('api.telegram.org'))).toBe(true);
    expect(urls.some((u) => u.includes('api.line.me'))).toBe(true);
    expect(urls).toContain('https://hook.test/x');
  });

  it('skips every channel (no request) when no secret is set', async () => {
    const f = recordingFetcher(() => Response.json({}));
    const r = await buildNotifier(f.fetcher, envWith({}), new InMemoryObservabilitySink()).deliver(
      JOB,
    );

    expect(r.delivered).toBe(0);
    expect(r.skipped).toBe(3);
    expect(f.calls).toBe(0);
  });

  it('activates only the channel whose secrets are present (independent mapping)', async () => {
    const urls: string[] = [];
    const f = recordingFetcher((url) => {
      urls.push(url);
      return Response.json({});
    });
    const env = envWith({ WEBHOOK_URL: 'https://hook.test/only', WEBHOOK_SIGNING_SECRET: 'sek' });
    const r = await buildNotifier(f.fetcher, env, new InMemoryObservabilitySink()).deliver(JOB);

    expect(r.delivered).toBe(1);
    expect(r.skipped).toBe(2);
    expect(urls).toEqual(['https://hook.test/only']);
  });
});
