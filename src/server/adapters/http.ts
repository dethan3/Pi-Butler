import { Router, Request, Response } from "express";
import type { Gateway } from "../gateway.js";
import type { IncomingMessage, OutgoingChunk } from "./types.js";

export function createHttpAdapter(gateway: Gateway): Router {
  const router = Router();

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
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
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
