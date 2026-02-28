#!/usr/bin/env node
import "dotenv/config";

import { createInterface } from "node:readline";
import { Agent } from "@mariozechner/pi-agent-core";
import { getModel } from "@mariozechner/pi-ai";
import chalk from "chalk";
import { allTools } from "./tools.js";

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
  const provider = process.env.PI_BUTLER_PROVIDER;
  const modelId = process.env.PI_BUTLER_MODEL;

  if (provider && modelId) {
    return getModel(provider as any, modelId as any);
  }

  // Try common providers in order of preference
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
        // Model ID might not match exactly; continue
      }
    }
  }

  console.error(
    chalk.red(
      "No LLM provider configured. Set one of:\n" +
        "  ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY / GEMINI_API_KEY\n" +
        "Or set PI_BUTLER_PROVIDER and PI_BUTLER_MODEL explicitly.",
    ),
  );
  process.exit(1);
}

// ── Main ──

async function main() {
  console.log(chalk.cyan.bold("\n╔══════════════════════════════════════════╗"));
  console.log(chalk.cyan.bold("║   🤖 Pi Butler — Personal Work Butler   ║"));
  console.log(chalk.cyan.bold("╚══════════════════════════════════════════╝\n"));

  const model = resolveModel();
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
