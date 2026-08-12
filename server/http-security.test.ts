import { describe, expect, it } from "vitest";
import { FixedWindowRateLimiter, normalizeCookieDomain } from "./http-security.js";

describe("HTTP security helpers", () => {
  it("enforces a fixed request window and resets after expiry", () => {
    const limiter = new FixedWindowRateLimiter({ limit: 2, windowMs: 1_000 });
    expect(limiter.consume("user", 0)).toMatchObject({ allowed: true, remaining: 1 });
    expect(limiter.consume("user", 100)).toMatchObject({ allowed: true, remaining: 0 });
    expect(limiter.consume("user", 200)).toMatchObject({ allowed: false, retryAfterSeconds: 1 });
    expect(limiter.consume("user", 1_000)).toMatchObject({ allowed: true, remaining: 1 });
  });

  it("normalizes supported cookie domains and rejects unsafe values", () => {
    expect(normalizeCookieDomain(" .beyour.top ")).toBe(".beyour.top");
    expect(normalizeCookieDomain(undefined)).toBeUndefined();
    expect(() => normalizeCookieDomain("https://beyour.top")).toThrow("COOKIE_DOMAIN 配置无效");
  });
});
