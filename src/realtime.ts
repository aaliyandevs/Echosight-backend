import type { Server } from "node:http";
import jwt from "jsonwebtoken";
import { WebSocketServer, type WebSocket } from "ws";
import { env } from "./config";

type ClientMessage =
  | { type: "ping"; requestId?: string }
  | { type: "signal"; targetUserId?: string; payload: unknown }
  | { type: "ice-candidate"; targetUserId?: string; candidate: unknown };

const clients = new Map<string, Set<WebSocket>>();

const addClient = (userId: string, socket: WebSocket) => {
  const existing = clients.get(userId) ?? new Set<WebSocket>();
  existing.add(socket);
  clients.set(userId, existing);
};

const removeClient = (userId: string, socket: WebSocket) => {
  const existing = clients.get(userId);
  if (!existing) return;
  existing.delete(socket);
  if (existing.size === 0) {
    clients.delete(userId);
  }
};

const send = (socket: WebSocket, payload: unknown) => {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
};

const resolveUserId = (token: string | null): string | null => {
  if (!token || !env.JWT_SECRET) return null;
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET);
    if (typeof decoded === "string") return decoded;
    return (
      (decoded.sub as string | undefined) ??
      (decoded.user_id as string | undefined) ??
      (decoded.uid as string | undefined) ??
      null
    );
  } catch {
    return null;
  }
};

export const attachRealtimeServer = (server: Server) => {
  const wss = new WebSocketServer({ server, path: "/realtime" });

  wss.on("connection", (socket, request) => {
    const url = new URL(request.url ?? "/realtime", "https://echosight-backend.vercel.app");
    const userId = resolveUserId(url.searchParams.get("token"));

    if (!userId) {
      send(socket, { type: "error", code: "AUTH_REQUIRED", message: "A valid token is required." });
      socket.close(1008, "auth required");
      return;
    }

    addClient(userId, socket);
    send(socket, {
      type: "ready",
      userId,
      iceServers: buildIceServers(),
    });

    socket.on("message", (raw) => {
      try {
        const message = JSON.parse(raw.toString()) as ClientMessage;
        if (message.type === "ping") {
          send(socket, { type: "pong", requestId: message.requestId ?? null, ts: Date.now() });
          return;
        }

        if (message.type === "signal" || message.type === "ice-candidate") {
          const targets = message.targetUserId ? clients.get(message.targetUserId) : clients.get(userId);
          targets?.forEach((target) => {
            if (target !== socket) {
              send(target, { ...message, fromUserId: userId });
            }
          });
        }
      } catch {
        send(socket, { type: "error", code: "INVALID_EVENT", message: "Realtime event is invalid." });
      }
    });

    socket.on("close", () => removeClient(userId, socket));
    socket.on("error", () => removeClient(userId, socket));
  });

  return wss;
};

const csv = (value?: string): string[] =>
  (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

export const buildIceServers = () => {
  const servers: Array<Record<string, unknown>> = csv(env.WEBRTC_STUN_URLS).map((urls) => ({ urls }));
  const turnUrls = csv(env.WEBRTC_TURN_URLS);
  if (turnUrls.length > 0) {
    servers.push({
      urls: turnUrls,
      username: env.WEBRTC_TURN_USERNAME,
      credential: env.WEBRTC_TURN_CREDENTIAL,
    });
  }
  return servers;
};
