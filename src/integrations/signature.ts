import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signature and idempotency helpers for inbound connectors (PRD §11.1, §11.2).
 *
 * Pure functions with no server dependencies so they can be unit-tested:
 * every inbound route verifies a provider signature over the *raw* body before
 * parsing it, and derives an idempotency key so a provider retry can never
 * create a second lead.
 */

/** Lowercase hex HMAC-SHA256 of the raw body. */
export function hmacHex(secret: string, rawBody: string): string {
  return createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
}

/**
 * Constant-time comparison of two signatures. Accepts both bare hex and the
 * `sha256=<hex>` form that Meta and our own website endpoint use.
 */
export function verifySignature(secret: string, rawBody: string, presented: string | null | undefined): boolean {
  if (!secret || !presented) return false;
  const offered = presented.startsWith("sha256=") ? presented.slice(7) : presented;
  if (!/^[0-9a-f]+$/i.test(offered)) return false;
  const expected = hmacHex(secret, rawBody);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(offered.toLowerCase(), "hex");
  // timingSafeEqual throws on a length mismatch, which is itself a rejection.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * A signed request must also be recent, otherwise a captured body could be
 * replayed forever. Default window is ±5 minutes.
 */
export function isFreshTimestamp(timestamp: string | null | undefined, nowMs = Date.now(), toleranceMs = 5 * 60 * 1000): boolean {
  if (!timestamp) return false;
  const raw = Number(timestamp);
  if (!Number.isFinite(raw)) return false;
  // Accept seconds or milliseconds.
  const ms = raw > 1e12 ? raw : raw * 1000;
  return Math.abs(nowMs - ms) <= toleranceMs;
}

/** Signs a payload the way the website endpoint expects. Used by the test panel. */
export function signPayload(secret: string, rawBody: string, timestamp: string): { signature: string; timestamp: string } {
  return { signature: `sha256=${hmacHex(secret, `${timestamp}.${rawBody}`)}`, timestamp };
}

/** The website endpoint signs `<timestamp>.<rawBody>` so the timestamp cannot be swapped. */
export function verifyTimestampedSignature(secret: string, rawBody: string, timestamp: string | null | undefined, presented: string | null | undefined): boolean {
  if (!timestamp) return false;
  return verifySignature(secret, `${timestamp}.${rawBody}`, presented);
}

export interface IdentityHint {
  submissionId?: string | null;
  phone?: string | null;
  email?: string | null;
  provider: string;
  occurredAtMs?: number;
}

/**
 * A stable key for one submission. A provider-supplied id is authoritative;
 * otherwise the identity plus the minute it arrived, so a double-submit from a
 * jumpy form collapses while a genuine second enquiry an hour later does not.
 */
export function buildIdempotencyKey(hint: IdentityHint): string {
  if (hint.submissionId && hint.submissionId.trim()) return `${hint.provider}:${hint.submissionId.trim()}`;
  const identity = (hint.phone || hint.email || "anonymous").trim().toLowerCase();
  const minute = Math.floor((hint.occurredAtMs ?? Date.now()) / 60000);
  const digest = createHash("sha256").update(`${hint.provider}|${identity}|${minute}`).digest("hex").slice(0, 32);
  return `${hint.provider}:${digest}`;
}

/**
 * In-memory per-IP token bucket. Enough to blunt a burst against one instance;
 * a durable limiter belongs in the worker (PRD §12.5) once one exists, because
 * serverless instances do not share this map.
 */
const buckets = new Map<string, { tokens: number; updatedAt: number }>();

export function takeToken(key: string, capacity = 20, refillPerSecond = 0.5, nowMs = Date.now()): boolean {
  const bucket = buckets.get(key) ?? { tokens: capacity, updatedAt: nowMs };
  const elapsed = (nowMs - bucket.updatedAt) / 1000;
  const tokens = Math.min(capacity, bucket.tokens + elapsed * refillPerSecond);
  if (tokens < 1) {
    buckets.set(key, { tokens, updatedAt: nowMs });
    return false;
  }
  buckets.set(key, { tokens: tokens - 1, updatedAt: nowMs });
  return true;
}

/** Test seam: clears the limiter between unit tests. */
export function resetRateLimiter() {
  buckets.clear();
}
