import { rateLimiter } from "hono-rate-limiter";
import type { AppEnv } from "../types";

const MINUTE = 60 * 1000;
const READ_METHODS = ["GET", "HEAD", "OPTIONS"];

// In-memory counters: fine for the single-instance deployment, reset on restart.
// Each limiter owns its own store, so limits do not share counters.
function limiter(opts: { windowMs: number; limit: number; message: string; writesOnly?: boolean }) {
  return rateLimiter<AppEnv>({
    windowMs: opts.windowMs,
    limit: opts.limit,
    standardHeaders: "draft-6",
    keyGenerator: (c) => c.get("ip") ?? "unknown",
    skip: opts.writesOnly ? (c) => READ_METHODS.includes(c.req.method) : undefined,
    handler: (c) => {
      c.header("Retry-After", String(Math.ceil(opts.windowMs / 1000)));
      return c.json({ error: opts.message }, 429);
    },
  });
}

export const loginLimiter = limiter({
  windowMs: 15 * MINUTE,
  limit: 10,
  message: "Too many login attempts. Try again later.",
});

export const registerLimiter = limiter({
  windowMs: 60 * MINUTE,
  limit: 5,
  message: "Too many sign-ups from this address. Try again later.",
});

export const writeLimiter = limiter({
  windowMs: MINUTE,
  limit: 120,
  message: "Too many requests. Slow down.",
  writesOnly: true,
});

export const chatLimiter = limiter({
  windowMs: MINUTE,
  limit: 20,
  message: "You are posting too fast. Slow down.",
  writesOnly: true,
});

// WebSocket connects: a client that is offline retries every few seconds, so leave headroom
export const wsLimiter = limiter({
  windowMs: MINUTE,
  limit: 60,
  message: "Too many connection attempts. Try again in a minute.",
});

export const importLimiter = limiter({
  windowMs: MINUTE,
  limit: 5,
  message: "Too many imports. Try again in a minute.",
  writesOnly: true,
});
