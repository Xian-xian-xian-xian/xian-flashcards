export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
};

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

export class FixedWindowRateLimiter {
  private readonly entries = new Map<string, RateLimitEntry>();

  constructor(private readonly options: { limit: number; windowMs: number; maxKeys?: number }) {}

  consume(key: string, now = Date.now()): RateLimitResult {
    const normalizedKey = key.trim() || "unknown";
    let entry = this.entries.get(normalizedKey);
    if (!entry || entry.resetAt <= now) {
      this.ensureCapacity(now, normalizedKey);
      entry = { count: 0, resetAt: now + this.options.windowMs };
      this.entries.set(normalizedKey, entry);
    }
    entry.count += 1;
    const allowed = entry.count <= this.options.limit;
    return {
      allowed,
      limit: this.options.limit,
      remaining: Math.max(0, this.options.limit - entry.count),
      retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000))
    };
  }

  reset(key: string) {
    this.entries.delete(key.trim() || "unknown");
  }

  private ensureCapacity(now: number, nextKey: string) {
    if (this.entries.has(nextKey)) return;
    const maxKeys = Math.max(100, this.options.maxKeys ?? 10_000);
    if (this.entries.size < maxKeys) return;
    for (const [key, entry] of this.entries) {
      if (entry.resetAt <= now) this.entries.delete(key);
    }
    while (this.entries.size >= maxKeys) {
      const oldestKey = this.entries.keys().next().value as string | undefined;
      if (!oldestKey) break;
      this.entries.delete(oldestKey);
    }
  }
}

export class TokenBucketRateLimiter {
  private readonly entries = new Map<string, { tokens: number; updatedAt: number }>();
  constructor(private readonly options: { capacity: number; refillPerSecond: number }) {}
  consume(key: string, now = Date.now()): RateLimitResult {
    const entry = this.entries.get(key) ?? { tokens: this.options.capacity, updatedAt: now };
    entry.tokens = Math.min(this.options.capacity, entry.tokens + Math.max(0, now - entry.updatedAt) / 1000 * this.options.refillPerSecond);
    entry.updatedAt = now;
    const allowed = entry.tokens >= 1;
    if (allowed) entry.tokens -= 1;
    if (!this.entries.has(key) && this.entries.size >= 10_000) this.entries.delete(this.entries.keys().next().value!);
    this.entries.set(key, entry);
    return { allowed, limit: this.options.capacity, remaining: Math.floor(entry.tokens), retryAfterSeconds: Math.max(1, Math.ceil((1 - entry.tokens) / this.options.refillPerSecond)) };
  }
}

export function boundedInteger(value: unknown, fallback: number, min: number, max: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.floor(number))) : fallback;
}

export function normalizeCookieDomain(value: string | undefined) {
  const domain = value?.trim();
  if (!domain) return undefined;
  if (!/^\.?[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(domain) || domain.includes("..")) {
    throw new Error("COOKIE_DOMAIN 配置无效");
  }
  return domain;
}

const productionCorsOrigins = new Set([
  "https://card.beyour.top",
  "https://tomato.beyour.top",
  "https://tomatogame.beyour.top"
]);

function configuredCorsOrigins(value: string | undefined) {
  return (value ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function isAllowedCorsOrigin(origin: string | undefined, options: { nodeEnv?: string; configuredOrigins?: string } = {}) {
  if (!origin) return true;
  const allowed = new Set([...productionCorsOrigins, ...configuredCorsOrigins(options.configuredOrigins)]);
  if (allowed.has(origin)) return true;
  if (options.nodeEnv === "production") return false;
  return /^https?:\/\/(?:localhost|127(?:\.\d{1,3}){3}|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})(?::\d{1,5})?$/.test(origin);
}
