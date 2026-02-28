import type { AgentEvent } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import { SessionManager } from "./session.js";
import type { IncomingMessage, OutgoingChunk } from "./adapters/types.js";
import { SYSTEM_PROMPT } from "./constants.js";

export { SYSTEM_PROMPT };

export function resolveModel() {
  const provider = process.env.PI_BUTLER_PROVIDER;
  const modelId = process.env.PI_BUTLER_MODEL;

  if (provider && modelId) {
    return getModel(provider as any, modelId as any);
  }

  const candidates: Array<{ provider: string; model: string; envKey: string }> = [
    { provider: "anthropic", model: "claude-sonnet-4-20250514", envKey: "ANTHROPIC_API_KEY" },
    { provider: "openai", model: "gpt-4o", envKey: "OPENAI_API_KEY" },
    { provider: "google", model: "gemini-2.5-flash", envKey: "GOOGLE_API_KEY" },
    { provider: "google", model: "gemini-2.5-flash", envKey: "GEMINI_API_KEY" },
  ];

  for (const c of candidates) {
    if (process.env[c.envKey]) {
      try {
        return getModel(c.provider as any, c.model as any);
      } catch {
        // continue
      }
    }
  }

  throw new Error(
    "No LLM provider configured. Set one of: ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY / GEMINI_API_KEY",
  );
}

export class Gateway {
  public readonly sessions: SessionManager;

  constructor() {
    this.sessions = new SessionManager(() => resolveModel());
  }

  async handleMessage(
    msg: IncomingMessage,
    onChunk: (chunk: OutgoingChunk) => void,
  ): Promise<void> {
    const session = this.sessions.getOrCreate(msg.channel, msg.userId);

    const unsubscribe = session.agent.subscribe((event: AgentEvent) => {
      switch (event.type) {
        case "message_update": {
          const aEvent = event.assistantMessageEvent;
          if (aEvent.type === "text_delta") {
            onChunk({ type: "text_delta", text: aEvent.delta });
          }
          break;
        }
        case "tool_execution_start":
          onChunk({ type: "tool_start", toolName: event.toolName });
          break;
        case "tool_execution_end":
          onChunk({ type: "tool_end", toolName: event.toolName, isError: event.isError });
          break;
        case "agent_end":
          break;
      }
    });

    try {
      await session.agent.prompt(msg.text);
      onChunk({ type: "done" });
    } catch (err) {
      onChunk({
        type: "error",
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      unsubscribe();
    }
  }

  async handleMessageCollected(msg: IncomingMessage): Promise<string> {
    let fullText = "";
    await this.handleMessage(msg, (chunk) => {
      if (chunk.type === "text_delta" && chunk.text) {
        fullText += chunk.text;
      }
    });
    return fullText;
  }

  destroy(): void {
    this.sessions.destroy();
  }
}
