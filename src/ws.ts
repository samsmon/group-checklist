import type { ServerWebSocket } from "bun";

type Socket = ServerWebSocket<unknown>;
type ClientMeta = { userId: string | null; ip: string };

// Close codes the browser client treats as "do not reconnect"
export const CLOSE_PRIVATE = 4403;
export const CLOSE_GONE = 4404;

export const MAX_PER_ROOM = 200;
export const MAX_PER_IP = 20;

// slug -> sockets in that room, with who they belong to
export const rooms = new Map<string, Map<Socket, ClientMeta>>();
const perIp = new Map<string, number>();

export function canJoin(slug: string, ip: string): "ok" | "room-full" | "too-many" {
  if ((rooms.get(slug)?.size ?? 0) >= MAX_PER_ROOM) return "room-full";
  if ((perIp.get(ip) ?? 0) >= MAX_PER_IP) return "too-many";
  return "ok";
}

export function joinRoom(slug: string, ws: Socket, meta: ClientMeta) {
  let room = rooms.get(slug);
  if (!room) rooms.set(slug, (room = new Map()));
  room.set(ws, meta);
  perIp.set(meta.ip, (perIp.get(meta.ip) ?? 0) + 1);
}

export function leaveRoom(slug: string, ws: Socket) {
  const room = rooms.get(slug);
  const meta = room?.get(ws);
  if (!room || !meta) return; // already removed (for example after a failed send)
  room.delete(ws);
  if (room.size === 0) rooms.delete(slug);
  const left = (perIp.get(meta.ip) ?? 1) - 1;
  if (left <= 0) perIp.delete(meta.ip);
  else perIp.set(meta.ip, left);
}

export function roomSize(slug: string): number {
  return rooms.get(slug)?.size ?? 0;
}

export function broadcastToRoom(slug: string, message: object) {
  const room = rooms.get(slug);
  if (!room || room.size === 0) return;
  const payload = JSON.stringify(message);
  for (const ws of [...room.keys()]) {
    try {
      ws.send(payload);
    } catch {
      leaveRoom(slug, ws);
    }
  }
}

// Disconnect everyone except `keepUserId` (pass null to close the whole room).
// Used when a project turns private or is deleted: sockets are authorised only at connect time.
export function closeRoom(slug: string, keepUserId: string | null, code: number, reason: string) {
  const room = rooms.get(slug);
  if (!room) return;
  for (const [ws, meta] of [...room]) {
    if (keepUserId !== null && meta.userId === keepUserId) continue;
    try {
      ws.close(code, reason);
    } catch {
      leaveRoom(slug, ws);
    }
  }
}
