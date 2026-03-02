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
    const inputText = ctx.message.text.trim();

    if (/^\/auth\s+status$/i.test(inputText) || /^授权状态$/.test(inputText)) {
      const status = gateway.getAuthStatus("telegram", String(ctx.from.id));
      if (status.connected) {
        await ctx.reply(`已绑定 OAuth：${status.provider ?? "unknown"}`);
      } else {
        await ctx.reply("当前未绑定 OAuth 账号。发送 /auth 开始授权。");
      }
      return;
    }

    if (/^\/auth$/i.test(inputText) || /^授权$/.test(inputText)) {
      try {
        const result = gateway.getOAuthEntryLink("telegram", String(ctx.from.id));
        await ctx.reply(
          [
            "请点击下方链接完成 OAuth 授权：",
            result.authUrl,
            "",
            "完成后可发送 /auth status 查看绑定状态。",
          ].join("\n"),
        );
      } catch (err) {
        await ctx.reply(`OAuth 当前不可用：${err instanceof Error ? err.message : String(err)}`);
      }
      return;
    }

    const msg: IncomingMessage = {
      channel: "telegram",
      userId: String(ctx.from.id),
      userName: ctx.from.first_name ?? ctx.from.username,
      text: inputText,
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
