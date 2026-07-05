import { matchesProfile } from './filter.js';
import { upsertJobs } from './db.js';
import { checkQuality } from './quality.js';

/** Fetch all sources → filter by profile → quality gate → upsert. Sources fail independently.
 *  Returns aggregate counts PLUS a per-source breakdown for health tracking. */
export async function runDiscover({ sources, profile, client, upsert = upsertJobs }) {
  const perSource = [];
  const matchedAll = [];
  let fetched = 0;
  let qualityDropped = 0;
  for (const s of sources) {
    try {
      const jobs = await s.fetch(profile);
      if (!Array.isArray(jobs)) throw new Error(`${s.name}: fetch did not return an array`);
      const m = jobs.filter((j) => matchesProfile(j, profile));
      const passed = m.filter((j) => checkQuality(j).ok);
      const dropped = m.length - passed.length;
      fetched += jobs.length;
      qualityDropped += dropped;
      matchedAll.push(...passed);
      perSource.push({ source: s.name, fetched: jobs.length, matched: m.length, qualityDropped: dropped, errored: false, error: null });
    } catch (e) {
      perSource.push({ source: s.name, fetched: 0, matched: 0, qualityDropped: 0, errored: true, error: String(e?.message ?? e).slice(0, 300) });
    }
  }
  const inserted = await upsert(client, matchedAll);
  const errors = perSource.filter((p) => p.errored).map((p) => p.source);
  return { fetched, matched: matchedAll.length, qualityDropped, inserted: inserted.length, errors, sources: perSource };
}
