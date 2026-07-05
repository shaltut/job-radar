import { basename } from 'node:path';
import { getJobsToTailor, setMaterials, setTailorError } from './db.js';
import { tailorJob } from './tailor.js';
import { sanitizeToken, sendTelegram, sendTelegramDocument } from './telegram.js';
import { buildFacts } from './tailorEngine.js';

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function defaultNotifyReady(job, m, telegram) {
  // m.cvPdf / m.coverPdf are ABSOLUTE paths (the DB stores basenames; Telegram upload needs the real path).
  const head = `📎 Materials ready — <b>${esc(job.title)}</b>${job.company ? ` @ ${esc(job.company)}` : ''}`;
  await sendTelegram(head, telegram);
  // Match the finance UI download name: [Applicant]-[YYYY-MM-DD]-[Company]-[CV|Cover].pdf
  const applicant = sanitizeToken(process.env.APPLICANT_NAME || 'Ahmed', 'Ahmed');
  const date = new Date().toISOString().slice(0, 10);
  const company = sanitizeToken(job.company || '', 'Company');
  const fname = (kind) => `${applicant}-${date}-${company}-${kind}.pdf`;
  await sendTelegramDocument(m.cvPdf, { ...telegram, caption: `📄 CV — ${job.title || ''}`, filename: fname('CV') });
  await sendTelegramDocument(m.coverPdf, { ...telegram, caption: `✉️ Cover — ${job.title || ''}`, filename: fname('Cover') });
}

async function defaultNotifyError(job, err, telegram) {
  const msg = String(err?.message || err).slice(0, 160);
  await sendTelegram(`⚠️ Tailoring failed — <b>${esc(job.title || job.id)}</b>: ${esc(msg)}`, telegram);
}

/** Tailor all shortlisted jobs lacking materials, serially. DI for testing. Returns {tailored, failed}. */
export async function runTailor({
  client, cvText, applyProfile = {}, openai = {}, outputDir, pdfScript, nodeBin, format, timeoutMs, limit = 5,
  telegram = {},
  getJobs = getJobsToTailor, tailor = tailorJob, write = setMaterials, fail = setTailorError,
  notifyReady = defaultNotifyReady, notifyError = defaultNotifyError,
}) {
  const jobs = await getJobs(client, { limit });
  let tailored = 0, failed = 0;
  for (const job of jobs) {
    try {
      const facts = buildFacts(applyProfile, job);
      const m = await tailor(job, { cvText, facts, openai, outputDir, pdfScript, nodeBin, format, timeoutMs });
      await write(client, job.id, basename(m.cvPdf), basename(m.coverPdf), m.answers);
      // notification is best-effort — a Telegram outage must not undo a successful write (which would
      // overwrite materials_status='ready' with 'error' and trigger a wasteful re-tailor next run).
      try { await notifyReady(job, m, telegram); } catch { /* best-effort */ }
      tailored++;
    } catch (e) {
      await fail(client, job.id, String(e?.message || e).slice(0, 500));
      try { await notifyError(job, e, telegram); } catch { /* never let a notify failure mask the error */ }
      failed++;
    }
  }
  return { tailored, failed };
}
