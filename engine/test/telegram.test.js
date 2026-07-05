import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeToken, sendTelegram, sendTelegramDocument } from '../src/telegram.js';

test('posts to the bot sendMessage endpoint with chat id and HTML', async () => {
  let captured;
  const fakeFetch = async (url, opts) => {
    captured = { url, body: JSON.parse(opts.body), method: opts.method };
    return { ok: true, json: async () => ({ ok: true }) };
  };
  await sendTelegram('hello', { token: 'T', chatId: '123', fetchImpl: fakeFetch });
  assert.match(captured.url, /\/botT\/sendMessage$/);
  assert.equal(captured.method, 'POST');
  assert.equal(captured.body.chat_id, '123');
  assert.equal(captured.body.text, 'hello');
  assert.equal(captured.body.parse_mode, 'HTML');
  assert.equal(captured.body.disable_web_page_preview, true);
});

test('throws if token or chatId missing', async () => {
  await assert.rejects(() => sendTelegram('x', { token: '', chatId: '1', fetchImpl: async () => ({}) }), /token/i);
  await assert.rejects(() => sendTelegram('x', { token: 'T', chatId: '', fetchImpl: async () => ({}) }), /chat/i);
});

test('throws on non-ok telegram response', async () => {
  const fakeFetch = async () => ({ ok: false, status: 400, json: async () => ({ description: 'bad' }) });
  await assert.rejects(() => sendTelegram('x', { token: 'T', chatId: '1', fetchImpl: fakeFetch }), /telegram/i);
});

test('sendTelegramDocument posts FormData with document + chat_id to /sendDocument', async () => {
  let captured;
  const fakeFetch = async (url, opts) => { captured = { url, opts }; return { ok: true, json: async () => ({ ok: true }) }; };
  await sendTelegramDocument('/x/cv.pdf', {
    token: 'T', chatId: '5', caption: 'CV', fetchImpl: fakeFetch, readFileImpl: async () => Buffer.from('PDF'),
  });
  assert.match(captured.url, /\/botT\/sendDocument$/);
  assert.ok(captured.opts.body instanceof FormData);
  assert.equal(captured.opts.body.get('chat_id'), '5');
  assert.equal(captured.opts.body.get('caption'), 'CV');
  assert.ok(captured.opts.body.get('document'));
  assert.equal(captured.opts.body.get('document').name, 'cv.pdf');
});

test('sendTelegramDocument throws on non-ok response', async () => {
  const fakeFetch = async () => ({ ok: false, status: 400, json: async () => ({ description: 'bad' }) });
  await assert.rejects(
    () => sendTelegramDocument('/x/cv.pdf', { token: 'T', chatId: '5', fetchImpl: fakeFetch, readFileImpl: async () => Buffer.from('x') }),
    /sendDocument failed: 400 bad/,
  );
});

test('sendTelegram includes reply_markup only when replyMarkup is provided', async () => {
  let body;
  const fetchImpl = async (_url, opts) => { body = JSON.parse(opts.body); return { ok: true, json: async () => ({ ok: true }) }; };
  const markup = { inline_keyboard: [[{ text: 'X', callback_data: 'sl:1' }]] };
  await sendTelegram('hi', { token: 'T', chatId: '1', fetchImpl, replyMarkup: markup });
  assert.deepEqual(body.reply_markup, markup);
  await sendTelegram('hi', { token: 'T', chatId: '1', fetchImpl });
  assert.equal('reply_markup' in body, false);
});

test('sanitizeToken keeps alphanumerics, collapses runs to -, falls back when empty', () => {
  assert.equal(sanitizeToken('DraftKings Inc.', 'Company'), 'DraftKings-Inc');
  assert.equal(sanitizeToken('  ***  ', 'Company'), 'Company');
  assert.equal(sanitizeToken('', 'Ahmed'), 'Ahmed');
});

test('sendTelegramDocument uses the provided filename for the document part', async () => {
  let body;
  const fakeFetch = async (_url, opts) => { body = opts.body; return { ok: true, json: async () => ({ ok: true }) }; };
  await sendTelegramDocument('/tmp/cv-13-confidential.pdf', {
    token: 't', chatId: 'c', filename: 'Ahmed-2026-06-21-DraftKings-Inc-CV.pdf',
    fetchImpl: fakeFetch, readFileImpl: async () => Buffer.from('pdf'),
  });
  const doc = body.get('document'); // FormData → File/Blob
  assert.equal(doc.name, 'Ahmed-2026-06-21-DraftKings-Inc-CV.pdf');
});
