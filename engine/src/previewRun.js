import { readFile } from 'node:fs/promises';
import { matchesProfile } from './filter.js';
import { checkQuality } from './quality.js';
import { buildSourcesFromDb } from './sources/index.js';
import { familyOf } from './sources/discoveryConfig.js';
import { loadDiscoveryConfig } from './discoveryStore.js';
import { mergeExcludes } from './sources/discoveryConfig.js';

/** Load the job-search profile from config/profile.json. */
async function defaultLoadProfile() {
  const raw = await readFile(new URL('../config/profile.json', import.meta.url), 'utf8');
  return JSON.parse(raw);
}

/**
 * Load the discovery config (source toggles, excludes), scoped to the engine's own
 * tenant (C2: config now lives in tenant_source_config, scoped to JOBRADAR_TENANT_ID —
 * the engine stays single-tenant, previews run against the owner's config).
 */
async function defaultLoadDiscoveryConfig(client, tenantId) {
  return loadDiscoveryConfig(client, tenantId);
}

/**
 * Run a capped, no-side-effect preview of a single source.
 *
 * - Loads the profile + discovery config (mirrors cli.js discover).
 * - Builds sources via getSources (default: buildSourcesFromDb) with previewLimit set.
 * - Picks ONE representative source whose familyOf(name) === sourceName.
 *   Prefers an exact name match; falls back to the first family match.
 * - Fetches and slices to `limit`.
 * - Flags each job with passesProfile + passesQuality.
 * - NEVER writes to the jobs table.
 *
 * Returns { fetched: int, kept: int, jobs: [{title, company, location, url, postedAt,
 *   tags, passesProfile, passesQuality, qualityReason}] }.
 */
export async function runPreview({
  client,
  sourceName,
  limit = 10,
  env = process.env,
  loadProfileFn = defaultLoadProfile,
  loadConfigFn = defaultLoadDiscoveryConfig,
  getSources = buildSourcesFromDb,
  matches = matchesProfile,
  quality = checkQuality,
} = {}) {
  const profile = await loadProfileFn();
  const cfg = await loadConfigFn(client, Number(env.JOBRADAR_TENANT_ID) || undefined);
  const mergedProfile = {
    ...profile,
    excludeKeywords: mergeExcludes(profile.excludeKeywords, cfg.excludes),
  };

  const sources = await getSources(env, client, { previewLimit: limit });

  // Prefer exact name match; fall back to first family match
  const exactMatch = sources.find((s) => s.name === sourceName);
  const src = exactMatch ?? sources.find((s) => familyOf(s.name) === sourceName);
  if (!src) throw new Error(`source not active: ${sourceName}`);

  const rawJobs = await src.fetch(mergedProfile);
  const fetched = rawJobs.slice(0, limit);

  const jobs = fetched.map((j) => {
    const q = quality(j);
    return {
      title: j.title ?? null,
      company: j.company ?? null,
      location: j.location ?? null,
      url: j.url ?? null,
      postedAt: j.postedAt ?? null,
      tags: Array.isArray(j.tags) ? j.tags : [],
      passesProfile: matches(j, mergedProfile),
      passesQuality: q.ok,
      qualityReason: q.ok ? null : q.reason,
    };
  });

  const kept = jobs.filter((j) => j.passesProfile && j.passesQuality).length;
  return { fetched: fetched.length, kept, jobs };
}
