import dns from 'node:dns';
// This box's IPv6 egress is broken; some endpoints (e.g. Careerjet's HTTP API)
// advertise AAAA records that hang. Prefer IPv4 for all outbound DNS this process.
dns.setDefaultResultOrder('ipv4first');

import { readFile, mkdir } from 'node:fs/promises';
import { makePool, dismissStaleJobs } from './db.js';
import { buildSourcesFromDb } from './sources/index.js';
import { loadDiscoveryConfig, recordCadenceRuns } from './discoveryStore.js';
import { mergeExcludes, familyOf } from './sources/discoveryConfig.js';
import { runDiscover } from './discover.js';
import { runDigest } from './digestRun.js';
import { loadResume, buildProfileText } from './resume.js';
import { runScore } from './scoreRun.js';
import { runTailor } from './tailorRun.js';
import { getApplyQueue } from './applyQueue.js';
import { recordApply } from './applied.js';
import { loadCredentials, lookupCredentials } from './credentials.js';
import { claimRuns, finishRuns, failRuns, enqueueRun } from './discoveryRuns.js';
import { recordSourceRuns } from './sourceRuns.js';
import { alertSourceErrors, alertCatastrophe } from './alerts.js';
import { claimPreview, finishPreview, failPreview } from './previewQueue.js';
import { runPreview } from './previewRun.js';
import { sendTelegram } from './telegram.js';
import { checkApifySpend } from './apifyUsage.js';

async function readStdin() {
  let data = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

async function loadProfile() {
  const raw = await readFile(new URL('../config/profile.json', import.meta.url), 'utf8');
  return JSON.parse(raw);
}

async function main() {
  const cmd = process.argv[2];
  const pool = makePool();
  const tg = { token: process.env.TELEGRAM_BOT_TOKEN, chatId: process.env.TELEGRAM_CHAT_ID };
  try {
    if (cmd === 'discover') {
      // --if-requested: only run when the finance UI has queued a request (the poller
      // timer uses this). Claim pending requests first; if none, exit cheaply.
      const ifRequested = process.argv.includes('--if-requested');
      let claimedIds = [];
      if (ifRequested) {
        claimedIds = await claimRuns(pool, 'discover');
        if (claimedIds.length === 0) { console.log('[discover] no pending request'); return; }
        console.log(`[discover] claimed ${claimedIds.length} request(s)`);
      }
      const profile = await loadProfile();
      // Best-effort DB config: source toggles + country subset + extra excludes.
      // Falls back to env flags + profile.json when the DB/tables are absent (P2).
      // C2: config lives in tenant_source_config, scoped to JOBRADAR_TENANT_ID — the
      // engine stays single-tenant (the owner) until Phase 4.
      const cfg = await loadDiscoveryConfig(pool, Number(process.env.JOBRADAR_TENANT_ID) || undefined);
      // Scheduled path (no --if-requested) respects cadence: skips sources not yet due.
      // Manual on-demand (--if-requested) always runs all enabled sources.
      const respectCadence = !ifRequested;
      const sources = await buildSourcesFromDb(process.env, pool, { respectCadence });
      const mergedProfile = { ...profile, excludeKeywords: mergeExcludes(profile.excludeKeywords, cfg.excludes) };
      try {
        const r = await runDiscover({ sources, profile: mergedProfile, client: pool });
        console.log(`[discover] fetched=${r.fetched} matched=${r.matched} inserted=${r.inserted} errors=${r.errors.join(',') || 'none'}`);
        try { await recordSourceRuns(pool, claimedIds[0] ?? null, r.sources); }
        catch (e) { console.error('[discover] recordSourceRuns failed:', e.message); }
        // Record cadence: stamp last_run_at for every family that was attempted this run
        // (only for the scheduled path — manual runs don't update cadence).
        if (respectCadence) {
          const families = [...new Set(sources.map((s) => familyOf(s.name)))];
          try { await recordCadenceRuns(pool, families); }
          catch (e) { console.error('[discover] recordCadenceRuns failed:', e.message); }
        }
        await alertSourceErrors(r.sources, tg); // best-effort; never throws
        await finishRuns(pool, claimedIds, { fetched: r.fetched, matched: r.matched, inserted: r.inserted, note: `${r.inserted} new (${r.fetched} fetched, ${r.matched} matched)` });
        // Chain: queue a score run for the poller (dedup-guarded). Runs for both scheduled
        // `discover` and on-demand `discover --if-requested`; only on success.
        await enqueueRun(pool, 'score', 'auto');
      } catch (e) {
        await failRuns(pool, claimedIds, e?.message || e);
        await alertCatastrophe('discover', e, tg);
        throw e;
      }
    } else if (cmd === 'score') {
      const ifRequested = process.argv.includes('--if-requested');
      let claimedIds = [];
      if (ifRequested) {
        claimedIds = await claimRuns(pool, 'score');
        if (claimedIds.length === 0) { console.log('[score] no pending request'); return; }
      }
      const resume = await loadResume();
      try {
        const r = await runScore({
          client: pool,
          profileText: buildProfileText(resume),
          all: process.argv.includes('--all'),
          backfill: process.argv.includes('--backfill'),
          threshold: Number(process.env.JOBRADAR_SCORE_THRESHOLD || 70),
          openai: {
            apiKey: process.env.OPENAI_API_KEY,
            model: process.env.JOBRADAR_SCORE_MODEL || 'gpt-5.5',
            effort: process.env.JOBRADAR_SCORE_EFFORT || 'high',
            maxTokens: Number(process.env.JOBRADAR_SCORE_MAX_TOKENS || 8000),
          },
        });
        console.log(`[score] scored=${r.scored} failed=${r.failed}`);
        if (r.scored === 0 && r.failed > 0) {
          await alertCatastrophe('score', new Error(`scored 0 of ${r.failed} jobs (possible API key/credit/quota outage)`), tg);
        }
        await finishRuns(pool, claimedIds, { inserted: r.scored, note: `scored ${r.scored}${r.failed ? `, ${r.failed} failed` : ''}` });
      } catch (e) {
        await failRuns(pool, claimedIds, e?.message || e);
        await alertCatastrophe('score', e, tg);
        throw e;
      }
    } else if (cmd === 'digest') {
      const staleDays = Number(process.env.JOBRADAR_STALE_DISMISS_DAYS || 60);
      const staleDismissed = await dismissStaleJobs(pool, { days: staleDays });
      if (staleDismissed.length) console.log(`[digest] auto-dismissed ${staleDismissed.length} stale jobs (>${staleDays}d)`);
      try {
        const ar = await checkApifySpend(pool, {
          token: process.env.APIFY_TOKEN,
          pct: Number(process.env.JOBRADAR_APIFY_SPEND_ALERT_PCT || 80),
          notify: (html) => sendTelegram(html, tg),
        });
        if (ar.alerted) console.log(`[digest] apify spend alert sent (${ar.pct}%)`);
      } catch (e) { console.error('[digest] apify spend check failed (non-fatal):', e?.message || e); }
      const r = await runDigest({
        client: pool,
        hours: Number(process.env.JOBRADAR_DIGEST_HOURS || 24),
        threshold: Number(process.env.JOBRADAR_SCORE_THRESHOLD || 70),
        appliedDays: Number(process.env.JOBRADAR_FOLLOWUP_APPLIED_DAYS || 7),
        interviewingDays: Number(process.env.JOBRADAR_FOLLOWUP_INTERVIEWING_DAYS || 5),
        token: process.env.TELEGRAM_BOT_TOKEN,
        chatId: process.env.TELEGRAM_CHAT_ID,
      });
      console.log(`[digest] sent ${r.sent} new, ${r.followups} follow-ups`);
    } else if (cmd === 'tailor') {
      const ifRequested = process.argv.includes('--if-requested');
      let claimedIds = [];
      if (ifRequested) {
        claimedIds = await claimRuns(pool, 'tailor');
        if (claimedIds.length === 0) { console.log('[tailor] no pending request'); return; }
      }
      const cvPath = process.env.JOBRADAR_CV_PATH || new URL('../config/cv.md', import.meta.url).pathname;
      const cvText = await readFile(cvPath, 'utf8');
      const profilePath = process.env.JOBRADAR_APPLY_PROFILE_PATH || new URL('../config/apply-profile.json', import.meta.url).pathname;
      let applyProfile = {};
      try { applyProfile = JSON.parse(await readFile(profilePath, 'utf8')); }
      catch (e) { if (e.code !== 'ENOENT') throw e; } // missing profile is fine; a malformed one should surface
      try {
        const r = await runTailor({
          client: pool,
          cvText,
          applyProfile,
          openai: {
            apiKey: process.env.OPENAI_API_KEY,
            model: process.env.JOBRADAR_TAILOR_MODEL || 'gpt-5.5',
            effort: process.env.JOBRADAR_TAILOR_EFFORT || 'high',
            maxTokens: Number(process.env.JOBRADAR_TAILOR_MAX_TOKENS || 16000),
          },
          outputDir: process.env.JOBRADAR_OUTPUT_DIR || new URL('../output', import.meta.url).pathname,
          pdfScript: process.env.JOBRADAR_PDF_SCRIPT || new URL('../pdf/generate-pdf.mjs', import.meta.url).pathname,
          format: process.env.JOBRADAR_PDF_FORMAT || 'a4',
          timeoutMs: Number(process.env.JOBRADAR_TAILOR_TIMEOUT_MS || 120000),
          limit: Number(process.env.JOBRADAR_TAILOR_LIMIT || 5),
          telegram: { token: process.env.TELEGRAM_BOT_TOKEN, chatId: process.env.TELEGRAM_CHAT_ID },
        });
        console.log(`[tailor] tailored=${r.tailored} failed=${r.failed}`);
        if (r.tailored === 0 && r.failed > 0) {
          await alertCatastrophe('tailor', new Error(`tailored 0 of ${r.failed} jobs (possible API key/credit/quota outage)`), tg);
        }
        await finishRuns(pool, claimedIds, { inserted: r.tailored, note: `tailored ${r.tailored}${r.failed ? `, ${r.failed} failed` : ''}` });
      } catch (e) {
        await failRuns(pool, claimedIds, e?.message || e);
        await alertCatastrophe('tailor', e, tg);
        throw e;
      }
    } else if (cmd === 'apply-queue') {
      const arg = process.argv.find((a) => a.startsWith('--limit='));
      const limit = arg ? Number(arg.split('=')[1]) : Number(process.env.JOBRADAR_APPLY_LIMIT || 5);
      const rows = await getApplyQueue(pool, { limit });
      console.log(JSON.stringify(rows));
    } else if (cmd === 'apply-record') {
      let record;
      try { record = JSON.parse(await readStdin()); }
      catch (e) { console.error(`apply-record: invalid JSON on stdin: ${e.message}`); process.exit(2); }
      const dir = process.env.JOBRADAR_APPLY_LOG_DIR || new URL('../apply-log', import.meta.url).pathname;
      await mkdir(dir, { recursive: true });
      const r = await recordApply(pool, record, { dir, nowIso: new Date().toISOString() });
      console.log(`ok ${JSON.stringify(r)}`);
    } else if (cmd === 'apply-creds') {
      const url = process.argv[3];
      if (!url) { console.error('usage: cli.js apply-creds <url>'); process.exit(2); }
      const path = process.env.JOBRADAR_CREDENTIALS_PATH || new URL('../config/credentials.json', import.meta.url).pathname;
      const creds = await loadCredentials(path);
      console.log(JSON.stringify(lookupCredentials(creds, url)));
    } else if (cmd === 'preview') {
      if (process.argv.includes('--if-requested')) {
        const row = await claimPreview(pool);
        if (!row) { console.log('[preview] no pending request'); return; }
        try {
          const r = await runPreview({ client: pool, sourceName: row.source, limit: row.lim });
          await finishPreview(pool, row.id, r);
          console.log(`[preview] ${row.source}: fetched ${r.fetched}, kept ${r.kept}`);
        } catch (e) {
          await failPreview(pool, row.id, String(e?.message || e));
          // do NOT rethrow — a bad preview should not crash the poller unit
        }
      } else {
        console.error('usage: cli.js preview --if-requested');
        process.exit(2);
      }
    } else {
      console.error('usage: cli.js <discover|score|digest|tailor|apply-queue|apply-record|apply-creds|preview>');
      process.exit(2);
    }
  } finally {
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
