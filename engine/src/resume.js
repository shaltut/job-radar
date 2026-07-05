import { readFile } from 'node:fs/promises';

/** Load the résumé profile snapshot from config/resume.json. */
export async function loadResume() {
  const raw = await readFile(new URL('../config/resume.json', import.meta.url), 'utf8');
  return JSON.parse(raw);
}

/** Render a résumé object into a compact text profile for the scoring prompt. */
export function buildProfileText(r) {
  const lines = [];
  if (r.name) lines.push(`Name: ${r.name}`);
  if (r.title) lines.push(`Current title: ${r.title}`);
  if (r.seniority) lines.push(`Seniority: ${r.seniority}`);
  if (r.years) lines.push(`Experience: ${r.years}`);
  if (r.location) lines.push(`Location: ${r.location}`);
  if (r.summary) lines.push(`Summary: ${r.summary}`);
  if (Array.isArray(r.skills) && r.skills.length) lines.push(`Skills: ${r.skills.join(', ')}`);
  if (Array.isArray(r.domains) && r.domains.length) lines.push(`Domains: ${r.domains.join(', ')}`);
  if (Array.isArray(r.experience) && r.experience.length) {
    lines.push('Experience history:');
    for (const e of r.experience) {
      const head = [e.title, e.company, e.dates].filter(Boolean).join(' | ');
      lines.push(`- ${head}${e.summary ? ` — ${e.summary}` : ''}`);
    }
  }
  if (Array.isArray(r.education) && r.education.length) {
    lines.push('Education/certs:');
    for (const ed of r.education) lines.push(`- ${[ed.title, ed.org, ed.year].filter(Boolean).join(' | ')}`);
  }
  return lines.join('\n');
}
