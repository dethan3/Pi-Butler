import { Router, Request, Response } from "express";
import type { Gateway } from "../gateway.js";
import type { IncomingMessage, OutgoingChunk } from "./types.js";
import type { AuthProvider } from "../auth/types.js";
import { toHttpError } from "../errors.js";

export function createHttpAdapter(gateway: Gateway): Router {
  const router = Router();

  // POST /api/auth/oauth/start
  router.post("/api/auth/oauth/start", (req: Request, res: Response) => {
    const {
      userId,
      channel,
      provider,
      redirectUri,
    } = req.body as {
      userId?: string;
      channel?: string;
      provider?: AuthProvider;
      redirectUri?: string;
    };

    if (!userId) {
      res.status(400).json({ error: "userId is required" });
      return;
    }

    try {
      const result = gateway.startOAuth({
        channel: channel ?? "http",
        userId,
        provider: provider ?? "openai_codex",
        redirectUri,
      });
      res.json(result);
    } catch (err) {
      const mapped = toHttpError(err, 400);
      res.status(mapped.status).json({ error: mapped.message, code: mapped.code });
    }
  });

  // GET /api/auth/oauth/callback
  router.get("/api/auth/oauth/callback", async (req: Request, res: Response) => {
    const code = String(req.query.code ?? "");
    const state = String(req.query.state ?? "");

    if (!code || !state) {
      res.status(400).json({ error: "code and state are required" });
      return;
    }

    try {
      const result = await gateway.completeOAuth({ code, state });
      res.json(result);
    } catch (err) {
      const mapped = toHttpError(err, 400);
      res.status(mapped.status).json({ error: mapped.message, code: mapped.code });
    }
  });

  // GET /api/auth/status?channel=http&userId=xxx
  router.get("/api/auth/status", (req: Request, res: Response) => {
    const channel = String(req.query.channel ?? "http");
    const userId = String(req.query.userId ?? "");

    if (!userId) {
      res.status(400).json({ error: "userId is required" });
      return;
    }

    const status = gateway.getAuthStatus(channel, userId);
    res.json(status);
  });

  // POST /api/auth/disconnect
  router.post("/api/auth/disconnect", (req: Request, res: Response) => {
    const { channel, userId } = req.body as { channel?: string; userId?: string };

    if (!userId) {
      res.status(400).json({ error: "userId is required" });
      return;
    }

    const ok = gateway.disconnectAuth(channel ?? "http", userId);
    res.json({ ok });
  });

  // POST /api/chat — SSE streaming response
  router.post("/api/chat", async (req: Request, res: Response) => {
    const { userId, message } = req.body as { userId?: string; message?: string };

    if (!userId || !message) {
      res.status(400).json({ error: "userId and message are required" });
      return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const msg: IncomingMessage = {
      channel: "http",
      userId,
      text: message,
      timestamp: Date.now(),
    };

    const sendEvent = (chunk: OutgoingChunk) => {
      res.write(`event: ${chunk.type}\ndata: ${JSON.stringify(chunk)}\n\n`);
    };

    try {
      await gateway.handleMessage(msg, sendEvent);
    } catch (err) {
      sendEvent({ type: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      res.end();
    }
  });

  // POST /api/chat/sync — non-streaming, returns full text
  router.post("/api/chat/sync", async (req: Request, res: Response) => {
    const { userId, message } = req.body as { userId?: string; message?: string };

    if (!userId || !message) {
      res.status(400).json({ error: "userId and message are required" });
      return;
    }

    const msg: IncomingMessage = {
      channel: "http",
      userId,
      text: message,
      timestamp: Date.now(),
    };

    try {
      const reply = await gateway.handleMessageCollected(msg);
      res.json({ reply });
    } catch (err) {
      const mapped = toHttpError(err, 500);
      res.status(mapped.status).json({ error: mapped.message, code: mapped.code });
    }
  });

  // POST /api/sessions/:channel/:userId/clear — clear session
  router.post("/api/sessions/:channel/:userId/clear", (req: Request, res: Response) => {
    const channel = String(req.params.channel);
    const userId = String(req.params.userId);
    gateway.sessions.delete(channel, userId);
    res.json({ ok: true });
  });

  // GET /health
  router.get("/health", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      activeSessions: gateway.sessions.size,
      uptime: process.uptime(),
    });
  });

  return router;
}
