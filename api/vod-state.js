const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Overlay-Secret',
  'Cache-Control': 'no-store',
};

function send(res, status, body) {
  Object.entries(corsHeaders).forEach(([key, value]) => res.setHeader(key, value));
  return res.status(status).json(body);
}

function validId(value) {
  return /^[a-f0-9-]{20,64}$/i.test(String(value || ''));
}

async function redis(command) {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error('REDIS_NOT_CONFIGURED');
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  if (!response.ok) throw new Error(`REDIS_HTTP_${response.status}`);
  const result = await response.json();
  if (result.error) throw new Error(result.error);
  return result.result;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  const channel = String(req.query.channel || '').toLowerCase();
  if (!validId(channel)) return send(res, 400, { ok: false, error: 'invalid channel' });
  const key = `soop-vod:${channel}`;

  try {
    if (req.method === 'GET') {
      const raw = await redis(['GET', key]);
      if (!raw) return send(res, 404, { ok: false, connected: false });
      const state = JSON.parse(raw);
      delete state.secret;
      state.connected = Date.now() - Number(state.updatedAt || 0) < 5000;
      return send(res, 200, { ok: true, ...state });
    }

    if (req.method === 'POST') {
      const secret = String(req.headers['x-overlay-secret'] || '');
      if (!validId(secret)) return send(res, 403, { ok: false, error: 'invalid secret' });
      const previous = await redis(['GET', key]);
      if (previous && JSON.parse(previous).secret !== secret) {
        return send(res, 403, { ok: false, error: 'wrong secret' });
      }
      const input = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const state = {
        secret,
        title: String(input.title || '제목 없음').slice(0, 300),
        currentTime: Number(input.currentTime) || 0,
        duration: Number(input.duration) || 0,
        paused: Boolean(input.paused),
        updatedAt: Date.now(),
      };
      await redis(['SET', key, JSON.stringify(state), 'EX', 86400]);
      return send(res, 200, { ok: true });
    }

    return send(res, 405, { ok: false, error: 'method not allowed' });
  } catch (error) {
    const message = error?.message === 'REDIS_NOT_CONFIGURED'
      ? 'Upstash Redis is not connected to this Vercel project.'
      : 'Backend request failed.';
    console.error('[vod-state]', error);
    return send(res, 503, { ok: false, error: message });
  }
}
