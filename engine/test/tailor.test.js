import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { slugify, tailorJob, defaultRenderPdf } from '../src/tailor.js';

test('slugify builds a filesystem-safe slug from id + company', () => {
  assert.equal(slugify({ id: 13, company: 'Acme Corp, Inc.' }), '13-acme-corp-inc');
  assert.equal(slugify({ id: 7, company: null }), '7-job');
});

test('tailorJob generates docs, writes HTML, renders both PDFs, returns manifest', async () => {
  const writes = []; const renders = [];
  const m = await tailorJob({ id: 13, company: 'Acme', title: 'SRE' }, {
    cvText: 'CV', openai: { apiKey: 'k', model: 'm' }, outputDir: '/out', pdfScript: '/gen.mjs',
    generate: async () => ({ cvHtml: '<html>cv</html>', coverHtml: '<html>cover</html>', answers: { summary: 'hi' } }),
    render: async (htmlPath, pdfPath) => { renders.push([htmlPath, pdfPath]); },
    writeFileImpl: async (p, c) => { writes.push([p, c]); },
    fileExists: async () => true,
  });
  assert.deepEqual(m, { cvPdf: '/out/cv-13-acme.pdf', coverPdf: '/out/cover-13-acme.pdf', reportMd: null, answers: { summary: 'hi' } });
  assert.deepEqual(writes.map((w) => w[0]), ['/out/cv-13-acme.html', '/out/cover-13-acme.html']);
  assert.deepEqual(renders, [
    ['/out/cv-13-acme.html', '/out/cv-13-acme.pdf'],
    ['/out/cover-13-acme.html', '/out/cover-13-acme.pdf'],
  ]);
});

test('tailorJob throws when a rendered PDF is missing', async () => {
  await assert.rejects(() => tailorJob({ id: 1, company: 'C' }, {
    cvText: 'CV', openai: {}, outputDir: '/out', pdfScript: '/gen.mjs',
    generate: async () => ({ cvHtml: 'a', coverHtml: 'b' }),
    render: async () => {},
    writeFileImpl: async () => {},
    fileExists: async (p) => p.includes('cv-'), // cover missing
  }), /cover PDF not found/);
});

// --- defaultRenderPdf seam tests (real spawn, fast) ---

test('defaultRenderPdf resolves with the pdf path on a zero-exit renderer', async () => {
  const ok = join(tmpdir(), 'jobradar-render-ok.mjs');
  writeFileSync(ok, 'process.exit(0)');
  try {
    const out = await defaultRenderPdf('/x.html', '/x.pdf', { pdfScript: ok, nodeBin: process.execPath });
    assert.equal(out, '/x.pdf');
  } finally { rmSync(ok, { force: true }); }
});

test('defaultRenderPdf rejects when the renderer exits non-zero', async () => {
  await assert.rejects(
    () => defaultRenderPdf('/x.html', '/x.pdf', { pdfScript: '/no/such/script-xyz.mjs', nodeBin: process.execPath }),
    /pdf render exited/,
  );
});

test('defaultRenderPdf kills and rejects on timeout', async () => {
  const hang = join(tmpdir(), 'jobradar-render-hang.mjs');
  writeFileSync(hang, 'setTimeout(() => {}, 60000)');
  try {
    await assert.rejects(
      () => defaultRenderPdf('/x.html', '/x.pdf', { pdfScript: hang, nodeBin: process.execPath, timeoutMs: 50 }),
      /timed out/,
    );
  } finally { rmSync(hang, { force: true }); }
});
