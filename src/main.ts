#!/usr/bin/env node
import "dotenv/config";

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { Agent } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import chalk from "chalk";
import { allTools } from "./tools.js";

type OpenAICompatPreset = {
  name: string;
  apiKeyEnvs: string[];
  baseUrlEnvs: string[];
  defaultBaseUrl: string;
  defaultModel: string;
};

const OPENAI_COMPAT_PRESETS: OpenAICompatPreset[] = [
  {
    name: "千问",
    apiKeyEnvs: ["DASHSCOPE_API_KEY", "QWEN_API_KEY"],
    baseUrlEnvs: ["DASHSCOPE_BASE_URL", "QWEN_BASE_URL"],
    defaultBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen-plus",
  },
  {
    name: "豆包",
    apiKeyEnvs: ["ARK_API_KEY", "DOUBAO_API_KEY"],
    baseUrlEnvs: ["ARK_BASE_URL", "DOUBAO_BASE_URL"],
    defaultBaseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    defaultModel: "doubao-1.5-pro-32k-250115",
  },
  {
    name: "Kimi",
    apiKeyEnvs: ["MOONSHOT_API_KEY", "KIMI_API_KEY"],
    baseUrlEnvs: ["MOONSHOT_BASE_URL", "KIMI_BASE_URL"],
    defaultBaseUrl: "https://api.moonshot.cn/v1",
    defaultModel: "moonshot-v1-8k",
  },
  {
    name: "DeepSeek",
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

// ── System Prompt ──

const SYSTEM_PROMPT = `You are a Personal Work Butler (AI Secretary) — a smart, proactive assistant that helps the user manage their daily work and life.

## Your Capabilities
You have tools to manage:
1. **Tasks** — Create, update, list, complete, and delete tasks with priorities, due dates, and tags.
2. **Schedule** — Create, update, list, and delete calendar events with start/end times and locations.
3. **Notes** — Create, update, search, and delete notes with tags.
4. **Daily Summary** — Provide a comprehensive briefing of today's tasks, overdue items, and upcoming events.
5. **Current Time** — Get the current date and time for time-aware operations.

## Behavior Guidelines
- Always be proactive: when the user mentions a meeting, deadline, or task, offer to create it.
- When showing lists, format them clearly with priorities, dates, and statuses.
- For daily briefings, highlight overdue and high-priority items first.
- Use natural, friendly language — you are a helpful secretary, not a robot.
- When a user's request is ambiguous, ask for clarification before acting.
- Always confirm destructive actions (delete) by summarizing what will be removed.
- Use the get_current_time tool when you need to know today's date for relative date references like "tomorrow", "next week", etc.
- Respond in the same language the user uses (e.g., Chinese if the user writes in Chinese).

## Date Handling
- When the user says "today", "tomorrow", "next Monday", etc., first call get_current_time to know the current date, then calculate the target date.
- Store dates in ISO format (YYYY-MM-DD for dates, YYYY-MM-DDTHH:mm:ss for datetimes).
`;

// ── Determine model from env or default ──

function resolveModel() {
  applyOpenAICompatAliases();

  const provider = process.env.PI_BUTLER_PROVIDER;
  const modelId = process.env.PI_BUTLER_MODEL;

  if (provider && modelId) {
    try {
      return getModel(provider as any, modelId as any);
    } catch {
      return null;
    }
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

  // Try other providers in order of preference
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
        // Model ID might not match exactly; continue
      }
    }
  }

  return null;
}

function askQuestion(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

function upsertEnvVarFile(varName: string, varValue: string): string {
  const envPath = join(process.cwd(), ".env");
  const escapedValue = varValue.replace(/\n/g, "\\n");
  const nextLine = `${varName}=${escapedValue}`;
  let content = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const lineRegex = new RegExp(`^\\s*${varName}=.*$`, "m");

  if (lineRegex.test(content)) {
    content = content.replace(lineRegex, nextLine);
  } else {
    const trimmed = content.trimEnd();
    content = trimmed ? `${trimmed}\n${nextLine}\n` : `${nextLine}\n`;
  }

  writeFileSync(envPath, content, "utf8");
  return envPath;
}

async function runOnboarding(): Promise<void> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log(chalk.yellow("\n⚠ 未检测到可用模型配置，进入首次引导。"));

  while (true) {
    console.log(chalk.cyan("\n请选择一种方式继续："));
    console.log("  1) OAuth 登录（推荐，复用 ChatGPT/Codex 订阅）");
    console.log("  2) 设置 AI API Key（当前终端会话生效）");
    console.log("  3) 退出\n");

    const choice = await askQuestion(rl, chalk.blue("输入选项 [1/2/3]: "));

    if (choice === "1") {
      console.log(chalk.white("\nOAuth 引导："));
      console.log(
        [
          "1. 启动服务端（若未启动）：pnpm dev:server",
          "2. 打开授权入口（浏览器）：",
          "   http://127.0.0.1:3000/api/auth/oauth/start?channel=cli&userId=local&provider=openai_codex",
          "3. 完成授权后回到此终端，按回车继续。",
        ].join("\n"),
      );
      await askQuestion(rl, chalk.blue("完成后按回车重试模型检测..."));
    } else if (choice === "2") {
      console.log(chalk.white("\n请选择配置方式："));
      console.log("  1) OpenAI 兼容（自定义中转站 URL + Model）");
      console.log("  2) 千问（DashScope）");
      console.log("  3) 豆包（Ark）");
      console.log("  4) Kimi（Moonshot）");
      console.log("  5) DeepSeek");
      console.log("  6) Anthropic");
      console.log("  7) Google/Gemini\n");

      const keyChoice = await askQuestion(rl, chalk.blue("选择配置类型 [1-7]: "));
      const envUpdates = new Map<string, string>();

      const setEnv = (key: string, value: string) => {
        process.env[key] = value;
        envUpdates.set(key, value);
      };

      const askApiKey = async () => {
        const keyValue = await askQuestion(rl, chalk.blue("粘贴 API Key: "));
        if (!keyValue) {
          console.log(chalk.red("API Key 为空，未保存。"));
          return null;
        }
        return keyValue;
      };

      if (keyChoice === "1") {
        const keyValue = await askApiKey();
        if (!keyValue) {
          continue;
        }
        const baseUrl = await askQuestion(
          rl,
          chalk.blue("输入 Base URL（例如 https://your-relay.example.com/v1）: "),
        );
        const model = await askQuestion(rl, chalk.blue("输入模型名（例如 qwen-plus / deepseek-chat）: "));
        if (!baseUrl || !model) {
          console.log(chalk.red("Base URL 或模型名为空，未保存。"));
          continue;
        }
        setEnv("PI_BUTLER_PROVIDER", "openai");
        setEnv("OPENAI_API_KEY", keyValue);
        setEnv("OPENAI_BASE_URL", baseUrl);
        setEnv("PI_BUTLER_MODEL", model);
      } else if (keyChoice === "2") {
        const keyValue = await askApiKey();
        if (!keyValue) {
          continue;
        }
        const model =
          (await askQuestion(rl, chalk.blue("模型名（默认 qwen-plus，直接回车使用默认）: "))) ||
          "qwen-plus";
        setEnv("PI_BUTLER_PROVIDER", "openai");
        setEnv("OPENAI_API_KEY", keyValue);
        setEnv("OPENAI_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1");
        setEnv("PI_BUTLER_MODEL", model);
      } else if (keyChoice === "3") {
        const keyValue = await askApiKey();
        if (!keyValue) {
          continue;
        }
        const model =
          (await askQuestion(rl, chalk.blue("模型名（默认 doubao-1.5-pro-32k-250115）: "))) ||
          "doubao-1.5-pro-32k-250115";
        setEnv("PI_BUTLER_PROVIDER", "openai");
        setEnv("OPENAI_API_KEY", keyValue);
        setEnv("OPENAI_BASE_URL", "https://ark.cn-beijing.volces.com/api/v3");
        setEnv("PI_BUTLER_MODEL", model);
      } else if (keyChoice === "4") {
        const keyValue = await askApiKey();
        if (!keyValue) {
          continue;
        }
        const model =
          (await askQuestion(rl, chalk.blue("模型名（默认 moonshot-v1-8k）: "))) ||
          "moonshot-v1-8k";
        setEnv("PI_BUTLER_PROVIDER", "openai");
        setEnv("OPENAI_API_KEY", keyValue);
        setEnv("OPENAI_BASE_URL", "https://api.moonshot.cn/v1");
        setEnv("PI_BUTLER_MODEL", model);
      } else if (keyChoice === "5") {
        const keyValue = await askApiKey();
        if (!keyValue) {
          continue;
        }
        const model =
          (await askQuestion(rl, chalk.blue("模型名（默认 deepseek-chat）: "))) || "deepseek-chat";
        setEnv("PI_BUTLER_PROVIDER", "openai");
        setEnv("OPENAI_API_KEY", keyValue);
        setEnv("OPENAI_BASE_URL", "https://api.deepseek.com/v1");
        setEnv("PI_BUTLER_MODEL", model);
      } else if (keyChoice === "6") {
        const keyValue = await askApiKey();
        if (!keyValue) {
          continue;
        }
        setEnv("ANTHROPIC_API_KEY", keyValue);
      } else if (keyChoice === "7") {
        const keyValue = await askApiKey();
        if (!keyValue) {
          continue;
        }
        setEnv("GOOGLE_API_KEY", keyValue);
      } else {
        console.log(chalk.red("无效选项，未保存。"));
        continue;
      }

      console.log(chalk.green("已注入环境变量，将立即重试模型检测。"));

      const persist = await askQuestion(rl, chalk.blue("是否写入当前目录 .env 以便下次自动生效？[y/N]: "));
      if (/^(y|yes)$/i.test(persist)) {
        try {
          let savedPath = "";
          for (const [key, value] of envUpdates) {
            savedPath = upsertEnvVarFile(key, value);
          }
          console.log(chalk.green(`已写入 ${savedPath}（${[...envUpdates.keys()].join(", ")}）`));
        } catch (err) {
          console.log(chalk.red(`写入 .env 失败：${err instanceof Error ? err.message : String(err)}`));
        }
      }
    } else if (choice === "3") {
      rl.close();
      process.exit(0);
    } else {
      console.log(chalk.red("无效选项，请重新输入。"));
      continue;
    }

    if (resolveModel()) {
      rl.close();
      return;
    }

    console.log(
      chalk.red(
        "\n仍未检测到可用模型。请确认：\n" +
          "- OAuth 已完成并可用于当前账号；或\n" +
          "- API Key / Base URL / Model 有效；或\n" +
          "- 使用 OPENAI_COMPAT_API_KEY + OPENAI_COMPAT_BASE_URL + OPENAI_COMPAT_MODEL；或\n" +
          "- 设置 PI_BUTLER_PROVIDER + PI_BUTLER_MODEL。",
      ),
    );
  }
}

// ── Main ──

async function main() {
  console.log(chalk.cyan.bold("\n╔══════════════════════════════════════════╗"));
  console.log(chalk.cyan.bold("║   🤖 Pi Butler — Personal Work Butler   ║"));
  console.log(chalk.cyan.bold("╚══════════════════════════════════════════╝\n"));

  if (!resolveModel()) {
    await runOnboarding();
  }

  const model = resolveModel();
  if (!model) {
    throw new Error("No LLM provider configured after onboarding.");
  }
  console.log(chalk.gray(`Model: ${model.provider}/${model.id}`));
  console.log(chalk.gray(`Data:  ~/.pi-butler/data/`));
  console.log(chalk.gray(`Type "exit" or "quit" to leave. Type your request below.\n`));

  const agent = new Agent({
    initialState: {
      systemPrompt: SYSTEM_PROMPT,
      model,
      tools: allTools,
    },
  });

  // Subscribe to events for streaming output
  agent.subscribe((event) => {
    switch (event.type) {
      case "message_update": {
        const aEvent = event.assistantMessageEvent;
        if (aEvent.type === "text_delta") {
          process.stdout.write(aEvent.delta);
        }
        break;
      }
      case "tool_execution_start":
        process.stdout.write(
          chalk.yellow(`\n⚙ [${event.toolName}] executing...\n`),
        );
        break;
      case "tool_execution_end":
        if (event.isError) {
          process.stdout.write(chalk.red(`✗ [${event.toolName}] error\n`));
        } else {
          process.stdout.write(chalk.green(`✓ [${event.toolName}] done\n`));
        }
        break;
      case "agent_end":
        process.stdout.write("\n");
        break;
    }
  });

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const promptUser = () => {
    rl.question(chalk.blue.bold("\n🧑 You: "), async (input) => {
      const trimmed = input.trim();
      if (!trimmed) {
        promptUser();
        return;
      }
      if (trimmed === "exit" || trimmed === "quit") {
        console.log(chalk.cyan("\nGoodbye! Have a productive day. 👋\n"));
        rl.close();
        process.exit(0);
      }

      process.stdout.write(chalk.magenta.bold("\n🤖 Butler: "));
      try {
        await agent.prompt(trimmed);
      } catch (err) {
        console.error(chalk.red(`\nError: ${err instanceof Error ? err.message : String(err)}`));
      }
      promptUser();
    });
  };

  promptUser();
}

// Catch unhandled rejections from agent-loop internals
process.on("unhandledRejection", (err) => {
  console.error(chalk.red(`\nError: ${err instanceof Error ? err.message : String(err)}`));
});

main().catch((err) => {
  console.error(chalk.red(`Fatal error: ${err.message}`));
  process.exit(1);
});
