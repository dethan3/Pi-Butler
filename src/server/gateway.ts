import type { AgentEvent } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import { SessionManager } from "./session.js";
import type { IncomingMessage, OutgoingChunk } from "./adapters/types.js";
import { SYSTEM_PROMPT } from "./constants.js";
import { TokenStore } from "./auth/token-store.js";
import { OAuthService } from "./auth/oauth.js";
import type { AuthProvider, OAuthCredential } from "./auth/types.js";
import { AppError } from "./errors.js";

export { SYSTEM_PROMPT };

type OpenAICompatPreset = {
  apiKeyEnvs: string[];
  baseUrlEnvs: string[];
  defaultBaseUrl: string;
  defaultModel: string;
};

const OPENAI_COMPAT_PRESETS: OpenAICompatPreset[] = [
  {
    apiKeyEnvs: ["DASHSCOPE_API_KEY", "QWEN_API_KEY"],
    baseUrlEnvs: ["DASHSCOPE_BASE_URL", "QWEN_BASE_URL"],
    defaultBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen-plus",
  },
  {
    apiKeyEnvs: ["ARK_API_KEY", "DOUBAO_API_KEY"],
    baseUrlEnvs: ["ARK_BASE_URL", "DOUBAO_BASE_URL"],
    defaultBaseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    defaultModel: "doubao-1.5-pro-32k-250115",
  },
  {
    apiKeyEnvs: ["MOONSHOT_API_KEY", "KIMI_API_KEY"],
    baseUrlEnvs: ["MOONSHOT_BASE_URL", "KIMI_BASE_URL"],
    defaultBaseUrl: "https://api.moonshot.cn/v1",
    defaultModel: "moonshot-v1-8k",
  },
  {
    apiKeyEnvs: ["DEEPSEEK_API_KEY"],
    baseUrlEnvs: ["DEEPSEEK_BASE_URL"],
    defaultBaseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
  },
];

function firstDefinedEnv(envs: string[]): string | undefined {
  for (const envName of envs) {
    const value = process.env[envName];
    if (value) {
      return value;
    }
  }
  return undefined;
}

function applyOpenAICompatAliases(): void {
  if (!process.env.OPENAI_API_KEY && process.env.OPENAI_COMPAT_API_KEY) {
    process.env.OPENAI_API_KEY = process.env.OPENAI_COMPAT_API_KEY;
  }
  if (!process.env.OPENAI_BASE_URL && process.env.OPENAI_COMPAT_BASE_URL) {
    process.env.OPENAI_BASE_URL = process.env.OPENAI_COMPAT_BASE_URL;
  }
  if (!process.env.PI_BUTLER_MODEL && process.env.OPENAI_COMPAT_MODEL) {
    process.env.PI_BUTLER_MODEL = process.env.OPENAI_COMPAT_MODEL;
  }

  for (const preset of OPENAI_COMPAT_PRESETS) {
    const apiKey = firstDefinedEnv(preset.apiKeyEnvs);
    if (!apiKey) {
      continue;
    }

    if (!process.env.OPENAI_API_KEY) {
      process.env.OPENAI_API_KEY = apiKey;
    }
    if (!process.env.OPENAI_BASE_URL) {
      process.env.OPENAI_BASE_URL = firstDefinedEnv(preset.baseUrlEnvs) ?? preset.defaultBaseUrl;
    }
    if (!process.env.PI_BUTLER_MODEL) {
      process.env.PI_BUTLER_MODEL = preset.defaultModel;
    }
    return;
  }
}

function openAIModelCandidates(): string[] {
  const candidates = [
    process.env.PI_BUTLER_MODEL,
    process.env.OPENAI_MODEL,
    ...OPENAI_COMPAT_PRESETS.map((p) => p.defaultModel),
    "gpt-4o",
  ];
  const deduped = new Set<string>();
  for (const candidate of candidates) {
    if (candidate) {
      deduped.add(candidate);
    }
  }
  return [...deduped];
}

export function resolveModel() {
  applyOpenAICompatAliases();

  const provider = process.env.PI_BUTLER_PROVIDER;
  const modelId = process.env.PI_BUTLER_MODEL;

  if (provider && modelId) {
    return getModel(provider as any, modelId as any);
  }
  if (process.env.OPENAI_API_KEY) {
    for (const candidateModel of openAIModelCandidates()) {
      try {
        return getModel("openai" as any, candidateModel as any);
      } catch {
        // continue
      }
    }
  }

  const candidates: Array<{ provider: string; model: string; envKey: string }> = [
    { provider: "anthropic", model: "claude-sonnet-4-20250514", envKey: "ANTHROPIC_API_KEY" },
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

  throw new AppError(
    "No LLM provider configured. Set OPENAI_API_KEY (or OPENAI_COMPAT_* / QWEN/DOUBAO/KIMI/DEEPSEEK aliases), or ANTHROPIC_API_KEY, or GOOGLE_API_KEY / GEMINI_API_KEY",
    503,
    "llm_not_configured",
  );
}

function resolveModelFromEnvWithKey(): { model: any; modelKey: string } {
  applyOpenAICompatAliases();

  const provider = process.env.PI_BUTLER_PROVIDER;
  const modelId = process.env.PI_BUTLER_MODEL;

  if (provider && modelId) {
    return {
      model: getModel(provider as any, modelId as any),
      modelKey: `env:${provider}:${modelId}:${process.env.OPENAI_BASE_URL ?? ""}`,
    };
  }

  if (process.env.OPENAI_API_KEY) {
    for (const candidateModel of openAIModelCandidates()) {
      try {
        return {
          model: getModel("openai" as any, candidateModel as any),
          modelKey: `env:openai:${candidateModel}:${process.env.OPENAI_BASE_URL ?? ""}`,
        };
      } catch {
        // continue
      }
    }
  }

  const candidates: Array<{ provider: string; model: string; envKey: string }> = [
    { provider: "anthropic", model: "claude-sonnet-4-20250514", envKey: "ANTHROPIC_API_KEY" },
    { provider: "google", model: "gemini-2.5-flash", envKey: "GOOGLE_API_KEY" },
    { provider: "google", model: "gemini-2.5-flash", envKey: "GEMINI_API_KEY" },
  ];

  for (const c of candidates) {
    if (process.env[c.envKey]) {
      try {
        return {
          model: getModel(c.provider as any, c.model as any),
          modelKey: `env:${c.provider}:${c.model}:${process.env.OPENAI_BASE_URL ?? ""}`,
        };
      } catch {
        // continue
      }
    }
  }

  throw new AppError(
    "No LLM provider configured. Set OPENAI_API_KEY (or OPENAI_COMPAT_* / QWEN/DOUBAO/KIMI/DEEPSEEK aliases), or ANTHROPIC_API_KEY, or GOOGLE_API_KEY / GEMINI_API_KEY",
    503,
    "llm_not_configured",
  );
}

export class Gateway {
  public readonly sessions: SessionManager;
  private readonly oAuthService: OAuthService;

  constructor() {
    this.sessions = new SessionManager();
    this.oAuthService = new OAuthService(new TokenStore());
  }

  startOAuth(params: {
    channel: string;
    userId: string;
    provider: AuthProvider;
    redirectUri?: string;
  }) {
    return this.oAuthService.startOAuth(
      params.channel,
      params.userId,
      params.provider,
      params.redirectUri,
    );
  }

  async completeOAuth(params: { code: string; state: string }) {
    const result = await this.oAuthService.completeOAuth(params.code, params.state);
    this.sessions.delete(result.channel, result.userId);
    return result;
  }

  getAuthStatus(channel: string, userId: string) {
    return this.oAuthService.getStatus(channel, userId);
  }

  disconnectAuth(channel: string, userId: string): boolean {
    const ok = this.oAuthService.disconnect(channel, userId);
    this.sessions.delete(channel, userId);
    return ok;
  }

  getOAuthEntryLink(channel: string, userId: string, redirectUri?: string) {
    return this.startOAuth({
      channel,
      userId,
      provider: "openai_codex",
      redirectUri,
    });
  }

  private createOpenAiModelFromCredential(credential: OAuthCredential): { model: any; modelKey: string } {
    const modelId = process.env.OAUTH_OPENAI_MODEL ?? process.env.PI_BUTLER_MODEL ?? "gpt-4o";
    const baseUrl = process.env.OAUTH_OPENAI_BASE_URL ?? process.env.OPENAI_BASE_URL;

    const prevOpenAiKey = process.env.OPENAI_API_KEY;
    const prevOpenAiBaseUrl = process.env.OPENAI_BASE_URL;

    process.env.OPENAI_API_KEY = credential.accessToken;
    if (baseUrl) {
      process.env.OPENAI_BASE_URL = baseUrl;
    } else {
      delete process.env.OPENAI_BASE_URL;
    }

    try {
      return {
        model: getModel("openai" as any, modelId as any),
        modelKey: `oauth:${credential.provider}:${modelId}:${baseUrl ?? ""}:${credential.updatedAt}`,
      };
    } catch {
      throw new AppError("OAuth model init failed", 502, "oauth_model_init_failed");
    } finally {
      if (prevOpenAiKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = prevOpenAiKey;
      }

      if (prevOpenAiBaseUrl === undefined) {
        delete process.env.OPENAI_BASE_URL;
      } else {
        process.env.OPENAI_BASE_URL = prevOpenAiBaseUrl;
      }
    }
  }

  private async resolveModelForUser(channel: string, userId: string): Promise<{ model: any; modelKey: string }> {
    try {
      const credential = await this.oAuthService.getCredential(channel, userId);
      if (credential) {
        return this.createOpenAiModelFromCredential(credential);
      }
    } catch {
      // fallback to env model resolution when OAuth path temporarily fails
    }
    return resolveModelFromEnvWithKey();
  }

  async handleMessage(
    msg: IncomingMessage,
    onChunk: (chunk: OutgoingChunk) => void,
  ): Promise<void> {
    const modelConfig = await this.resolveModelForUser(msg.channel, msg.userId);
    const session = this.sessions.getOrCreate(msg.channel, msg.userId, modelConfig);

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
    let errorText: string | null = null;
    await this.handleMessage(msg, (chunk) => {
      if (chunk.type === "text_delta" && chunk.text) {
        fullText += chunk.text;
      }
      if (chunk.type === "error") {
        errorText = chunk.text ?? "Unknown error";
      }
    });
    if (errorText !== null) {
      const errorMessage = String(errorText);
      if (errorMessage.includes("No LLM provider configured")) {
        throw new AppError(errorMessage, 503, "llm_not_configured");
      }
      if (errorMessage.includes("OAuth is not configured")) {
        throw new AppError(errorMessage, 503, "oauth_not_configured");
      }
      throw new AppError(errorMessage, 500, "chat_failed");
    }
    return fullText;
  }

  destroy(): void {
    this.sessions.destroy();
  }
}
