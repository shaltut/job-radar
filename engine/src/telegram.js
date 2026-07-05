import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

/** Filename-safe token: keep [A-Za-z0-9], collapse other runs to '-', trim '-'. Fallback when empty. */
export function sanitizeToken(value, fallback) {
  const token = String(value ?? '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return token || fallback;
}

/** Send an HTML message via the Telegram Bot API. */
export async function sendTelegram(text, { token, chatId, fetchImpl = fetch, replyMarkup } = {}) {
  if (!token) throw new Error('sendTelegram: missing bot token');
  if (!chatId) throw new Error('sendTelegram: missing chat id');
  const res = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true,
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    }),
  });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).description || ''; } catch { /* ignore */ }
    throw new Error(`telegram sendMessage failed: ${res.status} ${detail}`);
  }
  return res.json();
}

/** Upload a document (e.g. a PDF) to Telegram via multipart sendDocument. */
export async function sendTelegramDocument(filePath, { token, chatId, caption, filename, fetchImpl = fetch, readFileImpl = readFile } = {}) {
  if (!token) throw new Error('sendTelegramDocument: missing bot token');
  if (!chatId) throw new Error('sendTelegramDocument: missing chat id');
  const buf = await readFileImpl(filePath);
  const form = new FormData();
  form.append('chat_id', String(chatId));
  if (caption) form.append('caption', caption);
  form.append('document', new Blob([buf], { type: 'application/pdf' }), filename || basename(filePath));
  const res = await fetchImpl(`https://api.telegram.org/bot${token}/sendDocument`, { method: 'POST', body: form });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).description || ''; } catch { /* ignore */ }
    throw new Error(`telegram sendDocument failed: ${res.status} ${detail}`);
  }
  return res.json();
}
