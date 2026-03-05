/**
 * Telegram Integration Service
 * Provides API wrapper methods for Telegram Bot API.
 */

const TELEGRAM_API_BASE = "https://api.telegram.org";
const TELEGRAM_MESSAGE_LIMIT = 4096;

interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

export interface TelegramBotInfo {
  id: number;
  is_bot: boolean;
  username?: string;
  first_name?: string;
}

export interface TelegramRequestResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

function splitMessage(text: string, limit = TELEGRAM_MESSAGE_LIMIT): string[] {
  if (!text) return [""];
  if (text.length <= limit) return [text];

  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > limit) {
    let idx = remaining.lastIndexOf("\n", limit);
    if (idx <= 0) idx = limit;
    chunks.push(remaining.slice(0, idx));
    remaining = remaining.slice(idx).trimStart();
  }
  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}

async function telegramRequest<T>(
  botToken: string,
  method: string,
  body?: Record<string, unknown>,
): Promise<TelegramRequestResult<T>> {
  try {
    const response = await fetch(`${TELEGRAM_API_BASE}/bot${botToken}/${method}`, {
      method: body ? "POST" : "GET",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });

    const payload = await response.json() as TelegramApiResponse<T>;
    if (!response.ok || !payload.ok) {
      return {
        success: false,
        error: payload.description || `Telegram API request failed (${response.status})`,
      };
    }

    return { success: true, data: payload.result };
  } catch (error: any) {
    return { success: false, error: error?.message || "Telegram API request failed" };
  }
}

export function maskTelegramBotToken(token: string | null | undefined): string | null {
  if (!token) return null;
  if (token.length <= 10) return "********";
  return `${token.slice(0, 6)}...${token.slice(-4)}`;
}

export function normalizeTelegramChatIds(chatIds: unknown): string[] {
  if (!Array.isArray(chatIds)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of chatIds) {
    const value = String(entry || "").trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

export async function testTelegramConnection(botToken: string): Promise<TelegramRequestResult<TelegramBotInfo>> {
  return telegramRequest<TelegramBotInfo>(botToken, "getMe");
}

export async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  text: string,
): Promise<TelegramRequestResult<unknown>> {
  const chunks = splitMessage(text);
  for (const chunk of chunks) {
    const sendResult = await telegramRequest<unknown>(botToken, "sendMessage", {
      chat_id: chatId,
      text: chunk,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });
    if (!sendResult.success) {
      return sendResult;
    }
  }
  return { success: true };
}

export async function sendTelegramMessageToMany(
  botToken: string,
  chatIds: string[],
  text: string,
): Promise<{ sent: string[]; failed: Array<{ chat_id: string; error: string }> }> {
  const sent: string[] = [];
  const failed: Array<{ chat_id: string; error: string }> = [];

  for (const chatId of normalizeTelegramChatIds(chatIds)) {
    const result = await sendTelegramMessage(botToken, chatId, text);
    if (result.success) {
      sent.push(chatId);
    } else {
      failed.push({ chat_id: chatId, error: result.error || "Unknown error" });
    }
  }

  return { sent, failed };
}

