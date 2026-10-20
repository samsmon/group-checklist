import { describe, expect, test } from "bun:test";
import { api, register, sql } from "./helpers";

describe("auth", () => {
  test("register, me, login and logout", async () => {
    const me = await register("auth");
    const who = await api("GET", "/api/auth/me", { session: me });
    expect(who.json).toMatchObject({ id: me.id, username: me.username });

    const ok = await api("POST", "/api/auth/login", { ip: me.ip, body: { username: me.username, password: "correct-horse-battery" } });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("set-cookie")).toContain("HttpOnly");
    expect((await api("POST", "/api/auth/login", { ip: me.ip, body: { username: me.username, password: "wrong-password" } })).status).toBe(401);
    expect((await api("GET", "/api/auth/me")).status).toBe(401);
  });

  test("unknown user and wrong password look the same", async () => {
    const me = await register("same");
    const wrong = await api("POST", "/api/auth/login", { ip: "10.9.0.1", body: { username: me.username, password: "nope-nope-nope" } });
    const unknown = await api("POST", "/api/auth/login", { ip: "10.9.0.2", body: { username: "nobody-" + Date.now(), password: "nope-nope-nope" } });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(unknown.json).toEqual(wrong.json);
  });

  test("passwords are stored as bcrypt and old $2a$ hashes from other tools still verify", async () => {
    const me = await register("hash");
    const [{ password_hash }] = await sql`SELECT password_hash FROM users WHERE id = ${me.id}`;
    expect(password_hash).toStartWith("$2");

    // pgcrypto writes the same $2a$ format that bcryptjs produced for existing accounts
    const username = "legacy-" + Math.random().toString(36).slice(2, 8);
    await sql`INSERT INTO users (username, password_hash) VALUES (${username}, crypt('legacy-password', gen_salt('bf', 6)))`;
    const login = await api("POST", "/api/auth/login", { ip: "10.9.0.3", body: { username, password: "legacy-password" } });
    expect(login.status).toBe(200);
  });

  test("usernames with non-Latin characters can register and sign in", async () => {
    const ip = "10.9.0.4";
    const username = "名前-" + Math.random().toString(36).slice(2, 6);
    const reg = await api("POST", "/api/auth/register", { ip, body: { username, password: "correct-horse-battery" } });
    expect(reg.status).toBe(201);
    const cookie = (reg.headers.get("set-cookie") ?? "").split(";")[0];
    const who = await api("GET", "/api/auth/me", { session: { cookie, id: "", username, ip } });
    expect(who.json.username).toBe(username);
  });

  test("input checks", async () => {
    const ip = "10.9.0.5";
    const reg = (body: unknown) => api("POST", "/api/auth/register", { ip, body });
    expect((await reg({ username: "ab", password: "long-enough-pw" })).status).toBe(400);
    expect((await reg({ username: "fine-name", password: "short" })).status).toBe(400);
    expect((await reg({ username: "fine\u0000name", password: "long-enough-pw" })).status).toBe(400);
    expect((await reg({ username: "fine-name", password: "x".repeat(129) })).status).toBe(400);
    expect((await reg([1, 2])).status).toBe(400);
    expect((await api("POST", "/api/auth/login", { ip, body: { username: 5, password: 5 } })).status).toBe(400);
  });

  test("a malformed cookie is treated as signed out", async () => {
    const res = await api("GET", "/api/auth/me", { session: { cookie: "token=%", id: "", username: "", ip: "10.9.0.6" } });
    expect(res.status).toBe(401);
  });
});
