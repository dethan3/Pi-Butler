import { Bot } from "grammy";
import type { Gateway } from "../gateway.js";
import type { IncomingMessage } from "./types.js";

export function createTelegramAdapter(gateway: Gateway): Bot | null {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return null;
  }

  const bot = new Bot(token);

  bot.on("message:text", async (ctx) => {
    const msg: IncomingMessage = {
      channel: "telegram",
      userId: String(ctx.from.id),
      userName: ctx.from.first_name ?? ctx.from.username,
      text: ctx.message.text,
      timestamp: ctx.message.date * 1000,
    };

    let fullText = "";
    await gateway.handleMessage(msg, (chunk) => {
      if (chunk.type === "text_delta" && chunk.text) {
        fullText += chunk.text;
      }
    });

    if (fullText) {
      // Telegram has 4096 char limit per message
      const MAX_LEN = 4000;
      if (fullText.length <= MAX_LEN) {
        await ctx.reply(fullText);
      } else {
        // Split into chunks
        for (let i = 0; i < fullText.length; i += MAX_LEN) {
          await ctx.reply(fullText.slice(i, i + MAX_LEN));
        }
      }
    } else {
      await ctx.reply("(No response generated)");
    }
  });

  return bot;
}
