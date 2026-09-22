// Minimal in-memory fixed-window rate limiter (per process).
// Right-sized for a hackathon deploy: protects the auth/onboarding/chat
// surfaces from scripts without adding a dependency. On serverless each
// instance keeps its own window — still caps abuse spikes per instance.
const buckets = new Map();

export function rateLimit({ key, limit, windowMs }) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now - b.start > windowMs) {
    b = { start: now, count: 0 };
    buckets.set(key, b);
    if (buckets.size > 5000) for (const [k, v] of buckets) if (now - v.start > windowMs) buckets.delete(k);
  }
  b.count += 1;
  return {
    allowed: b.count <= limit,
    remaining: Math.max(0, limit - b.count),
    retryAfterMs: b.count > limit ? Math.max(1000, windowMs - (now - b.start)) : 0,
  };
}

export function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

// Express middleware factory.
export function limiter({ limit, windowMs, keyFn }) {
  return (req, res, next) => {
    const r = rateLimit({ key: keyFn(req), limit, windowMs });
    if (!r.allowed) {
      res.setHeader('Retry-After', Math.ceil(r.retryAfterMs / 1000));
      return res.status(429).json({ error: 'Too many requests — slow down.' });
    }
    next();
  };
}
