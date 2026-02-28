import { Agent } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import { Storage, getUserDataDir } from "../storage.js";
import { createTools } from "../tools.js";
import { SYSTEM_PROMPT } from "./constants.js";
import type { ChannelType } from "./adapters/types.js";

export interface Session {
  id: string;
  channel: ChannelType;
  userId: string;
  agent: Agent;
  storage: Storage;
  createdAt: number;
  lastActiveAt: number;
}

const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

export class SessionManager {
  private sessions = new Map<string, Session>();
  private cleanupTimer: ReturnType<typeof setInterval>;

  constructor(private resolveModel: () => ReturnType<typeof getModel>) {
    this.cleanupTimer = setInterval(() => this.cleanup(), 60_000);
  }

  private makeKey(channel: string, userId: string): string {
    return `${channel}:${userId}`;
  }

  getOrCreate(channel: ChannelType, userId: string): Session {
    const key = this.makeKey(channel, userId);
    let session = this.sessions.get(key);
    if (session) {
      session.lastActiveAt = Date.now();
      return session;
    }

    const dataDir = getUserDataDir(channel, userId);
    const storage = new Storage(dataDir);
    const tools = createTools(storage);
    const model = this.resolveModel();

    const agent = new Agent({
      initialState: {
        systemPrompt: SYSTEM_PROMPT,
        model,
        tools,
      },
    });

    session = {
      id: key,
      channel,
      userId,
      agent,
      storage,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    };

    this.sessions.set(key, session);
    return session;
  }

  get(channel: string, userId: string): Session | undefined {
    return this.sessions.get(this.makeKey(channel, userId));
  }

  delete(channel: string, userId: string): boolean {
    return this.sessions.delete(this.makeKey(channel, userId));
  }

  get size(): number {
    return this.sessions.size;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, session] of this.sessions) {
      if (now - session.lastActiveAt > SESSION_TIMEOUT_MS) {
        this.sessions.delete(key);
      }
    }
  }

  destroy(): void {
    clearInterval(this.cleanupTimer);
    this.sessions.clear();
  }
}
