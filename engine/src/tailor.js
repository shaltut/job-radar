import { spawn } from 'node:child_process';
import { writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { generateTailoredDocs } from './tailorEngine.js';

/** A filesystem-safe slug for a job's output files, e.g. "13-acme-corp". */
export function slugify(job) {
  const base = `${job.id}-${job.company || 'job'}`;
  return base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || `job-${job.id}`;
}

/** Default: does a file exist? */
export async function defaultFileExists(p) {
  try { await access(p); return true; } catch { return false; }
}

/** Default: render an HTML file to PDF via the local generate-pdf.mjs (Playwright). Rejects on non-zero/timeout. */
export function defaultRenderPdf(htmlPath, pdfPath, { pdfScript, nodeBin = process.execPath, format = 'a4', timeoutMs = 120_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(nodeBin, [pdfScript, htmlPath, pdfPath, `--format=${format}`], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    let settled = false;
    const settle = (fn) => { if (settled) return; settled = true; clearTimeout(timer); fn(); };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      settle(() => reject(new Error(`tailor: pdf render timed out after ${timeoutMs}ms`)));
    }, timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => settle(() => reject(e)));
    child.on('close', (code) => settle(() => {
      if (code === 0) resolve(pdfPath);
      else reject(new Error(`tailor: pdf render exited ${code}: ${(err + out).trim().slice(-400) || '(no output)'}`));
    }));
  });
}

/**
 * Tailor one job: OpenAI generates tailored CV + cover HTML → render both to PDF → verify.
 * Returns { cvPdf, coverPdf, reportMd, answers } (absolute paths + tailored apply answers). Throws on failure.
 */
export async function tailorJob(job, {
  cvText, facts = '', openai = {}, outputDir, pdfScript, nodeBin = process.execPath, format = 'a4', timeoutMs = 120_000,
  generate = generateTailoredDocs, render = defaultRenderPdf, writeFileImpl = writeFile, fileExists = defaultFileExists,
} = {}) {
  const docs = await generate(job, { cvText, facts, ...openai });
  const slug = slugify(job);
  const cvHtmlPath = join(outputDir, `cv-${slug}.html`);
  const cvPdf = join(outputDir, `cv-${slug}.pdf`);
  const coverHtmlPath = join(outputDir, `cover-${slug}.html`);
  const coverPdf = join(outputDir, `cover-${slug}.pdf`);

  await writeFileImpl(cvHtmlPath, docs.cvHtml, 'utf8');
  await render(cvHtmlPath, cvPdf, { pdfScript, nodeBin, format, timeoutMs });
  await writeFileImpl(coverHtmlPath, docs.coverHtml, 'utf8');
  await render(coverHtmlPath, coverPdf, { pdfScript, nodeBin, format, timeoutMs });

  if (!(await fileExists(cvPdf))) throw new Error(`tailor: CV PDF not found: ${cvPdf}`);
  if (!(await fileExists(coverPdf))) throw new Error(`tailor: cover PDF not found: ${coverPdf}`);
  return { cvPdf, coverPdf, reportMd: null, answers: docs.answers };
}
