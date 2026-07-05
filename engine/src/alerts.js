import { sendTelegram } from './telegram.js';
import { formatSourceAlert, formatCatastrophe } from './digest.js';

/** Best-effort send: never throws. Skips when text is null or token/chatId missing. */
async function tryNotify(text, { token, chatId, fetchImpl } = {}) {
  if (!text || !token || !chatId) return false;
  try {
    await sendTelegram(text, { token, chatId, fetchImpl });
    return true;
  } catch (e) {
    console.error('[alert] telegram send failed:', e.message);
    return false;
  }
}

/** Ping listing sources that errored in a discover run. No-op when none errored. */
export async function alertSourceErrors(perSource, opts) {
  return tryNotify(formatSourceAlert(perSource), opts);
}

/** Ping for a whole-step failure (discover/score/tailor threw). */
export async function alertCatastrophe(kind, err, opts) {
  return tryNotify(formatCatastrophe(kind, err), opts);
}
