import { describe, expect, test } from "bun:test";
import {
  BadRequest, cleanText, escapeLike, hasControlChars, isUuid, optionalBool, parseLimit, parseOffset, readJson,
} from "../src/lib/validate";
import { canJoin, closeRoom, joinRoom, leaveRoom, broadcastToRoom, roomSize, MAX_PER_IP, MAX_PER_ROOM } from "../src/ws";

describe("validate", () => {
  test("cleanText", () => {
    expect(cleanText("  hi ", 10)).toBe("hi");
    expect(cleanText(undefined, 5)).toBe("");
    expect(cleanText(null, 5)).toBe("");
    expect(() => cleanText("abcdef", 5)).toThrow(BadRequest);
    expect(() => cleanText(5, 5)).toThrow(BadRequest);
    expect(() => cleanText("a\u0000b", 5)).toThrow(BadRequest);
    expect(cleanText("a\nb", 5)).toBe("a\nb");
  });

  test("numbers, ids and flags", () => {
    expect(parseLimit("abc", 50, 200)).toBe(50);
    expect(parseLimit("9999", 50, 200)).toBe(200);
    expect(parseLimit("0", 50, 200)).toBe(1);
    expect(parseOffset("-3")).toBe(0);
    expect(parseOffset("40")).toBe(40);
    expect(parseOffset("99999999999")).toBe(100000);
    expect(isUuid("3f2b8c1e-1111-4222-8333-444455556666")).toBe(true);
    expect(isUuid("abc")).toBe(false);
    expect(hasControlChars("a\u0001")).toBe(true);
    expect(hasControlChars("名前")).toBe(false);
    expect(optionalBool(undefined, "x")).toBeUndefined();
    expect(optionalBool(false, "x")).toBe(false);
    expect(() => optionalBool("true", "x")).toThrow(BadRequest);
  });

  test("escapeLike makes wildcards literal", () => {
    expect(escapeLike("50%_off\\")).toBe("50\\%\\_off\\\\");
  });

  test("readJson accepts only objects", async () => {
    const ctx = (text: string) => ({ req: { json: async () => JSON.parse(text) } }) as any;
    expect(((await readJson(ctx('{"a":1}'))) as any).a).toBe(1);
    for (const bad of ["{x", "[1]", "null", '"s"']) {
      await expect(readJson(ctx(bad))).rejects.toBeInstanceOf(BadRequest);
    }
  });
});

describe("websocket rooms", () => {
  const sock = () => {
    const s: any = { closed: null as number | null, sent: [] as string[], send(m: string) { s.sent.push(m); }, close(code: number) { s.closed = code; } };
    return s;
  };

  test("per-IP and per-room limits, and leaving twice frees one slot", () => {
    const socks = Array.from({ length: MAX_PER_IP }, sock);
    socks.forEach((s) => joinRoom("limit-a", s, { userId: null, ip: "1.1.1.1" }));
    expect(canJoin("limit-a", "1.1.1.1")).toBe("too-many");
    expect(canJoin("limit-a", "2.2.2.2")).toBe("ok");
    leaveRoom("limit-a", socks[0]);
    leaveRoom("limit-a", socks[0]);
    expect(canJoin("limit-a", "1.1.1.1")).toBe("ok");
    expect(roomSize("limit-a")).toBe(MAX_PER_IP - 1);

    for (let i = 0; i < MAX_PER_ROOM; i++) joinRoom("limit-b", sock(), { userId: null, ip: `9.9.${i % 250}.${Math.floor(i / 250)}` });
    expect(canJoin("limit-b", "3.3.3.3")).toBe("room-full");
  });

  test("closeRoom keeps the owner and drops everyone else", () => {
    const owner = sock(), viewer = sock(), anon = sock();
    joinRoom("close-a", owner, { userId: "u1", ip: "4.4.4.4" });
    joinRoom("close-a", viewer, { userId: "u2", ip: "5.5.5.5" });
    joinRoom("close-a", anon, { userId: null, ip: "6.6.6.6" });
    closeRoom("close-a", "u1", 4403, "private");
    expect(owner.closed).toBeNull();
    expect(viewer.closed).toBe(4403);
    expect(anon.closed).toBe(4403);
    closeRoom("close-a", null, 4404, "gone");
    expect(owner.closed).toBe(4404);
  });

  test("a socket whose send throws is dropped, the others still get the message", () => {
    const bad = sock(); bad.send = () => { throw new Error("closed"); };
    const good = sock();
    joinRoom("bc", bad, { userId: null, ip: "7.7.7.7" });
    joinRoom("bc", good, { userId: null, ip: "8.8.8.8" });
    broadcastToRoom("bc", { event: "x" });
    expect(roomSize("bc")).toBe(1);
    expect(good.sent.length).toBe(1);
  });
});
