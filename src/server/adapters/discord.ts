import { Client, GatewayIntentBits, Events } from "discord.js";
import type { Gateway } from "../gateway.js";
import type { IncomingMessage } from "./types.js";

export function createDiscordAdapter(gateway: Gateway): Client | null {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    return null;
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  client.on(Events.MessageCreate, async (message) => {
    // Ignore bot's own messages and other bots
    if (message.author.bot) return;
    if (!message.content) return;

    // Only respond to DMs or when mentioned in a guild
    const isMentioned = message.mentions.has(client.user!);
    const isDM = !message.guild;
    if (!isDM && !isMentioned) return;

    // Strip the mention from the text
    let text = message.content;
    if (isMentioned && client.user) {
      text = text.replace(new RegExp(`<@!?${client.user.id}>`, "g"), "").trim();
    }
    if (!text) return;

    const msg: IncomingMessage = {
      channel: "discord",
      userId: message.author.id,
      userName: message.author.displayName ?? message.author.username,
      text,
      timestamp: message.createdTimestamp,
    };

    // Show typing indicator
    await message.channel.sendTyping();

    let fullText = "";
    await gateway.handleMessage(msg, (chunk) => {
      if (chunk.type === "text_delta" && chunk.text) {
        fullText += chunk.text;
      }
    });

    if (fullText) {
      // Discord has 2000 char limit per message
      const MAX_LEN = 1900;
      if (fullText.length <= MAX_LEN) {
        await message.reply(fullText);
      } else {
        for (let i = 0; i < fullText.length; i += MAX_LEN) {
          await message.channel.send(fullText.slice(i, i + MAX_LEN));
        }
      }
    } else {
      await message.reply("(No response generated)");
    }
  });

  client.login(token);
  return client;
}
