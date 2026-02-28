import "dotenv/config";
import express from "express";
import { Gateway } from "./gateway.js";
import { createHttpAdapter } from "./adapters/http.js";
import { createTelegramAdapter } from "./adapters/telegram.js";
import { createDiscordAdapter } from "./adapters/discord.js";

const PORT = parseInt(process.env.PI_BUTLER_PORT ?? "3000", 10);

async function main() {
  const gateway = new Gateway();
  const app = express();

  app.use(express.json());
  app.use(createHttpAdapter(gateway));

  // Telegram Bot
  const telegramBot = createTelegramAdapter(gateway);
  if (telegramBot) {
    telegramBot.start();
    console.log("[Telegram] Bot started");
  } else {
    console.log("[Telegram] Skipped (no TELEGRAM_BOT_TOKEN)");
  }

  // Discord Bot
  const discordClient = createDiscordAdapter(gateway);
  if (discordClient) {
    discordClient.once("ready", (c) => {
      console.log(`[Discord] Logged in as ${c.user.tag}`);
    });
  } else {
    console.log("[Discord] Skipped (no DISCORD_BOT_TOKEN)");
  }

  // HTTP Server
  app.listen(PORT, () => {
    console.log(`\n[Pi Butler Server] listening on http://0.0.0.0:${PORT}`);
    console.log(`  POST /api/chat          — SSE streaming`);
    console.log(`  POST /api/chat/sync     — blocking JSON`);
    console.log(`  GET  /health            — health check`);
    console.log();
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log("\nShutting down...");
    if (telegramBot) telegramBot.stop();
    gateway.destroy();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

process.on("unhandledRejection", (err) => {
  console.error("[unhandledRejection]", err instanceof Error ? err.message : String(err));
});

main().catch((err) => {
  console.error(`Fatal: ${err.message}`);
  process.exit(1);
});
