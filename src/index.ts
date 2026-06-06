// TEMPORARY spike entrypoint — Phase 0b reachability gate.
// Confirms Cloudflare Workers egress can reach the Bitkub public API.
// This file is replaced by the real worker entrypoint during the build and the
// spike route is removed before production (Phase 11).

const USER_AGENT = 'thai-crypto-signals/0.0.0 (+https://github.com/talkstream/thai-crypto-signals)';
const BASE_URL = 'https://api.bitkub.com';

export default {
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname !== '/spike') {
      return new Response('thai-crypto-signals (spike)\n', { status: 200 });
    }

    const startedMs = Date.now();
    const headers = { 'User-Agent': USER_AGENT, Accept: 'application/json' };

    const serverTimeRes = await fetch(`${BASE_URL}/api/v3/servertime`, { headers });
    const serverTimeText = (await serverTimeRes.text()).trim();
    const serverTime = Number(serverTimeText);

    const tickerRes = await fetch(`${BASE_URL}/api/v3/market/ticker`, { headers });
    const ticker = (await tickerRes.json()) as unknown;
    const symbolCount = Array.isArray(ticker) ? ticker.length : 0;

    const ok = serverTimeRes.ok && tickerRes.ok && Number.isFinite(serverTime) && symbolCount > 0;

    return Response.json(
      {
        ok,
        servertime: Number.isFinite(serverTime) ? serverTime : null,
        servertime_status: serverTimeRes.status,
        ticker_status: tickerRes.status,
        ticker_symbol_count: symbolCount,
        latency_ms: Date.now() - startedMs,
        cf_colo: req.headers.get('cf-ray'),
      },
      { status: ok ? 200 : 502 },
    );
  },
};
