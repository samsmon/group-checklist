import type { Context } from "hono";

// Thrown for malformed client input; the global error handler turns it into a 400.
export class BadRequest extends Error {}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// C0 controls (except \t \n \r) and DEL. NUL in particular makes Postgres reject the row.
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export function hasControlChars(value: string): boolean {
  return CONTROL_RE.test(value);
}

// Parse the JSON body; anything other than an object is a 400 instead of a 500.
export async function readJson<T extends object>(c: Context): Promise<T> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new BadRequest("invalid JSON body");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new BadRequest("JSON body must be an object");
  }
  return body as T;
}

// Trimmed string, "" when the field is absent. Rejects non-strings, control chars and over-long text.
export function cleanText(value: unknown, max: number, field = "value"): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new BadRequest(`${field} must be a string`);
  const text = value.trim();
  if (text.length > max) throw new BadRequest(`${field} must be at most ${max} characters`);
  if (hasControlChars(text)) throw new BadRequest(`${field} contains invalid characters`);
  return text;
}

// A boolean field that may be absent; anything else (including "true") is a 400.
export function optionalBool(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new BadRequest(`${field} must be true or false`);
  return value;
}

// Query-string offset: 0 when missing or invalid, capped so it cannot be abused.
export function parseOffset(raw: string | undefined, max = 100000): number {
  const n = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : 0;
}

// Make a user's search text literal inside ILIKE ('%' and '_' are wildcards, '\' escapes).
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => "\\" + c);
}

// Query-string limit: default when missing or not a number, clamped to [1, max].
export function parseLimit(raw: string | undefined, fallback: number, max: number): number {
  const n = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, 1), max);
}
