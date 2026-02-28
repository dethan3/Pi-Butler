export type ChannelType = "telegram" | "discord" | "http";

export interface IncomingMessage {
  channel: ChannelType;
  userId: string;
  userName?: string;
  text: string;
  timestamp: number;
}

export interface OutgoingChunk {
  type: "text_delta" | "tool_start" | "tool_end" | "done" | "error";
  text?: string;
  toolName?: string;
  isError?: boolean;
}
