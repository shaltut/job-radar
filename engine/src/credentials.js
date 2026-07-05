import { readFile } from 'node:fs/promises';

/** Load the domain→credentials map from JSON; returns {} if missing/unreadable. */
export async function loadCredentials(path, { readImpl = readFile } = {}) {
  try { return JSON.parse(await readImpl(path, 'utf8')); } catch { return {}; }
}

/** Find credentials for a URL or host by exact host then parent domains (leading "www." stripped). */
export function lookupCredentials(creds, urlOrHost) {
  if (!creds || !urlOrHost) return null;
  let host;
  try { host = new URL(urlOrHost).hostname; } catch { host = String(urlOrHost); }
  host = host.replace(/^www\./, '').toLowerCase();
  if (!host) return null;
  const parts = host.split('.');
  // Walk from the full host down to the registrable domain; the `- 1` bound excludes a bare TLD.
  for (let i = 0; i < parts.length - 1; i++) {
    const cand = parts.slice(i).join('.');
    if (creds[cand]) return creds[cand];
  }
  return null;
}
