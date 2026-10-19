import { Hono } from "hono";
import sql from "../db";
import type { AppEnv, User } from "../types";
import type { Context, Next } from "hono";
import { readJson, hasControlChars } from "../lib/validate";

const auth = new Hono<AppEnv>();

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error("JWT_SECRET is not set");
}
if (JWT_SECRET.length < 32) {
  throw new Error("JWT_SECRET must be at least 32 characters (try: openssl rand -hex 32)");
}
const COOKIE_NAME = "token";
const COOKIE_TTL = 60 * 60 * 24 * 30; // 30 days

// ---- Passwords ----
// Bun's native bcrypt runs off the main thread (bcryptjs blocked the event loop for ~300 ms per
// call) and verifies the $2a$/$2b$ hashes bcryptjs produced. bcrypt rather than the argon2
// default: it needs almost no memory, so parallel logins cannot exhaust the container.

const BCRYPT_COST = 12;
const hashPassword = (password: string) => Bun.password.hash(password, { algorithm: "bcrypt", cost: BCRYPT_COST });
const verifyPassword = (password: string, hash: string) => Bun.password.verify(password, hash);
// Compared against when the username does not exist, so a miss costs the same as a wrong password
const DUMMY_HASH = await hashPassword("timing-equalisation-only");

// ---- JWT (HS256, Web Crypto — no external dep) ----

function b64urlEncode(buf: ArrayBuffer | Uint8Array): string {
  let str = "";
  for (const b of new Uint8Array(buf)) str += String.fromCharCode(b);
  return btoa(str).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function b64urlDecode(s: string): Uint8Array {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(pad), (c) => c.charCodeAt(0));
}

// JSON <-> base64url as UTF-8 (btoa alone throws on non-Latin1 characters)
function encodeJson(value: object): string {
  return b64urlEncode(new TextEncoder().encode(JSON.stringify(value)));
}

function decodeJson(s: string): any {
  return JSON.parse(new TextDecoder().decode(b64urlDecode(s)));
}

async function hmacKey(secret: string, usage: "sign" | "verify") {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    [usage]
  );
}

async function jwtSign(payload: object): Promise<string> {
  const header = encodeJson({ alg: "HS256", typ: "JWT" });
  const body = encodeJson(payload);
  const data = `${header}.${body}`;
  const key = await hmacKey(JWT_SECRET, "sign");
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return `${data}.${b64urlEncode(sig)}`;
}

async function jwtVerify(token: string): Promise<{ sub: string; username: string }> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("malformed token");

  const [header, body, sig] = parts;
  const key = await hmacKey(JWT_SECRET, "verify");
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    b64urlDecode(sig),
    new TextEncoder().encode(`${header}.${body}`)
  );
  if (!valid) throw new Error("invalid signature");

  const payload = decodeJson(body);
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error("token expired");
  }
  return payload;
}

// ---- Cookie helpers ----

function cookieString(token: string) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_TTL}; Path=/${secure}`;
}

function parseCookieHeader(header: string | undefined, name: string): string | null {
  if (!header) return null;
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null; // malformed percent-encoding: treat as no cookie
  }
}

function jsonWithCookie(data: object, token: string, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": cookieString(token),
    },
  });
}

// ---- Auth middleware ----

export async function authMiddleware(c: Context<AppEnv>, next: Next) {
  const token = parseCookieHeader(c.req.header("cookie"), COOKIE_NAME);
  c.set("user", null);

  if (token) {
    try {
      const payload = await jwtVerify(token);
      c.set("user", { id: payload.sub, username: payload.username } as User);
    } catch (err) {
      console.warn("[auth] verify failed:", (err as Error).message);
    }
  }

  await next();
}

// ---- Routes ----

// POST /api/auth/register
auth.post("/register", async (c) => {
  const body = await readJson<{ username?: string; password?: string }>(c);
  const { username = "", password = "" } = body;

  if (typeof username !== "string" || typeof password !== "string")
    return c.json({ error: "username and password must be strings" }, 400);
  if (!username || !password)
    return c.json({ error: "username and password required" }, 400);
  if (hasControlChars(username))
    return c.json({ error: "username contains invalid characters" }, 400);
  if (password.length > 128)
    return c.json({ error: "password must be at most 128 characters" }, 400);
  if (username.length < 3 || username.length > 32)
    return c.json({ error: "username must be 3-32 characters" }, 400);
  if (password.length < 8)
    return c.json({ error: "password must be at least 8 characters" }, 400);

  const existing = await sql`SELECT id FROM users WHERE username = ${username}`;
  if (existing.length > 0)
    return c.json({ error: "username already taken" }, 409);

  const hash = await hashPassword(password);
  const [user] = await sql<{ id: string; username: string }[]>`
    INSERT INTO users (username, password_hash)
    VALUES (${username}, ${hash})
    RETURNING id, username
  `;

  const token = await jwtSign({
    sub: user.id,
    username: user.username,
    exp: Math.floor(Date.now() / 1000) + COOKIE_TTL,
  });

  return jsonWithCookie({ id: user.id, username: user.username }, token, 201);
});

// POST /api/auth/login
auth.post("/login", async (c) => {
  const body = await readJson<{ username?: string; password?: string }>(c);
  const { username = "", password = "" } = body;

  if (typeof username !== "string" || typeof password !== "string")
    return c.json({ error: "username and password must be strings" }, 400);
  if (!username || !password || username.length > 32 || password.length > 128)
    return c.json({ error: "invalid credentials" }, 401);

  const [user] = await sql<{ id: string; username: string; password_hash: string }[]>`
    SELECT id, username, password_hash FROM users WHERE username = ${username}
  `;
  const valid = await verifyPassword(password, user?.password_hash ?? DUMMY_HASH);
  if (!user || !valid) return c.json({ error: "invalid credentials" }, 401);

  const token = await jwtSign({
    sub: user.id,
    username: user.username,
    exp: Math.floor(Date.now() / 1000) + COOKIE_TTL,
  });

  return jsonWithCookie({ id: user.id, username: user.username }, token);
});

// POST /api/auth/logout
auth.post("/logout", () => {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Max-Age=0; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT`,
    },
  });
});

// GET /api/auth/me
auth.get("/me", authMiddleware, (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "not authenticated" }, 401);
  return c.json(user);
});

export default auth;
