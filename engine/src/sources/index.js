import { fetchRemotive } from './remotive.js';
import { fetchRemoteOk } from './remoteok.js';
import { fetchJobicy } from './jobicy.js';
import { fetchArbeitnow } from './arbeitnow.js';
import { fetchWeWorkRemotely } from './weworkremotely.js';
import { fetchHimalayas } from './himalayas.js';
import { fetchHackerNews } from './hackernews.js';
import { fetchReddit } from './reddit.js';
import { fetchFreelancer } from './freelancer.js';
import { fetchCareerjet, CAREERJET_LOCALES } from './careerjet.js';
import { makeApifySource } from './apify.js';
import { toISOOrNull, stripHtml, relativeToISO, dmyToISO } from '../normalize.js';
import { applySourceToggles, familyOf, isSourceDue } from './discoveryConfig.js';
import { loadDiscoveryConfig } from '../discoveryStore.js';
import { applyFilters } from './filters.js';

/** The Gulf (GCC) countries we target for MENA sources. */
// `naukri` = the country value NaukriGulf's actor accepts (UAE uses the short "UAE";
// the rest equal `loc`). `iso2` = the GulfTalent actor's country value.
export const MENA_COUNTRIES = [
  { key: 'uae', baytSlug: 'uae', loc: 'United Arab Emirates', iso2: 'AE', naukri: 'UAE', city: 'Dubai' },
  { key: 'ksa', baytSlug: 'saudi-arabia', loc: 'Saudi Arabia', iso2: 'SA', naukri: 'Saudi Arabia', city: 'Riyadh' },
  { key: 'qatar', baytSlug: 'qatar', loc: 'Qatar', iso2: 'QA', naukri: 'Qatar', city: 'Doha' },
  { key: 'kuwait', baytSlug: 'kuwait', loc: 'Kuwait', iso2: 'KW', naukri: 'Kuwait', city: 'Kuwait City' },
  { key: 'bahrain', baytSlug: 'bahrain', loc: 'Bahrain', iso2: 'BH', naukri: 'Bahrain', city: 'Manama' },
  { key: 'oman', baytSlug: 'oman', loc: 'Oman', iso2: 'OM', naukri: 'Oman', city: 'Muscat' },
];

/** Slug a keyword for a Bayt URL path, e.g. "Senior Backend" -> "senior-backend". */
const keywordSlug = (s) => String(s || 'software').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'software';

/** Bayt country jobs search URL. */
export function baytStartUrl(countrySlug, keyword) {
  return `https://www.bayt.com/en/${countrySlug}/jobs/${keywordSlug(keyword)}-jobs/`;
}

/** LinkedIn guest job-search URL: remote→worldwide+f_WT=2, else a country location. */
export function linkedinSearchUrl(keyword, { loc, remote } = {}) {
  const params = new URLSearchParams({ keywords: keyword || 'software' });
  if (remote) { params.set('location', 'Worldwide'); params.set('f_WT', '2'); }
  else if (loc) { params.set('location', loc); }
  return `https://www.linkedin.com/jobs/search/?${params.toString()}`;
}

/** Map a curious_coder/linkedin-jobs-scraper dataset item to a CanonicalJob (market 'global'|'mena'). */
export const linkedinMap = (market) => (r) => ({
  source: 'linkedin',
  externalId: r.id ?? null,
  title: r.title,
  company: r.companyName ?? null,
  location: r.location || null,
  remote: market === 'global',
  url: r.link || r.applyUrl,
  description: r.descriptionText ?? stripHtml(r.descriptionHtml),
  tags: Array.isArray(r.industries) ? r.industries : (typeof r.industries === 'string' && r.industries ? [r.industries] : []),
  market,
  postedAt: toISOOrNull(r.postedAt),
});

/** The existing Bayt dataset → CanonicalJob map (unchanged shape). */
const baytMap = (r) => ({
  source: 'bayt',
  externalId: r.jobId ?? null,
  title: r.title,
  company: r.company ?? null,
  location: r.location || 'MENA',
  remote: false,
  url: r.url || r.applyUrl,
  description: r.descriptionText ?? stripHtml(r.descriptionHtml),
  tags: typeof r.skillsText === 'string' && r.skillsText.trim()
    ? r.skillsText.split(/[,\n;]+/).map((s) => s.trim()).filter(Boolean).slice(0, 20)
    : [],
  market: 'mena',
  postedAt: relativeToISO(r.postedAtRelative, r.scrapedAt),
});

// NaukriGulf + GulfTalent are genuine GCC boards; Wuzzuf (Egypt-centric) is kept as an
// option too. All paid Apify actors, flag-gated OFF (P3), never auto-run. NaukriGulf/
// GulfTalent OUTPUT field names are not yet verified against a live run, so their maps
// read defensively. Verify + tighten on the first live `discover` after enabling.

/** shahidirfan/wuzzuf-jobs-scraper dataset → CanonicalJob (MENA/Egypt). */
const wuzzufMap = (r) => ({
  source: 'wuzzuf',
  externalId: null,
  title: r.title,
  company: r.company ?? null,
  location: r.location || 'MENA',
  remote: false,
  url: r.url,
  description: r.description_text ?? stripHtml(r.description_html),
  tags: Array.isArray(r.skills) ? r.skills : [],
  market: 'mena',
  postedAt: dmyToISO(r.date_posted),   // Wuzzuf returns DD/MM/YYYY HH:MM:SS, not US MM/DD
});

/** blackfalcondata/naukrigulf-scraper dataset → CanonicalJob (Gulf onsite). */
const naukrigulfMap = (r) => ({
  source: 'naukrigulf', externalId: r.jobId ?? r.jobKey ?? null, title: r.title,
  company: r.company ?? null, location: r.location || 'Gulf', remote: r.locationType === 'Remote',
  url: r.url, description: r.description ?? stripHtml(r.descriptionHtml),
  tags: Array.isArray(r.keywords) ? r.keywords : [], market: 'mena', postedAt: toISOOrNull(r.postedAt),
});

/** shahidirfan/GulfTalent-Job-Scraper dataset → CanonicalJob (Gulf onsite). */
const gulftalentMap = (r) => ({
  source: 'gulftalent', externalId: r.job_id ?? null, title: r.title, company: r.company ?? null,
  location: r.location || 'Gulf', remote: !!r.is_remote, url: r.url,
  description: r.description_text ?? stripHtml(r.description_html),
  tags: [r.category, r.industry].filter(Boolean), market: 'mena', postedAt: toISOOrNull(r.date_posted),
});

/** valig/indeed-jobs-scraper dataset → CanonicalJob. Wide-net fallback spanning both legs. */
const indeedMap = (market) => (r) => ({
  source: 'indeed', externalId: r.key ?? r.refNum ?? null, title: r.title,
  company: r.employer?.name ?? (typeof r.employer === 'string' ? r.employer : null),
  location: [r.location?.city, r.location?.countryName].filter(Boolean).join(', ') || (market === 'global' ? 'Remote' : 'Gulf'),
  remote: market === 'global', url: r.url || r.jobUrl, description: r.description ?? null,
  tags: r.jobTypes && typeof r.jobTypes === 'object' ? Object.values(r.jobTypes) : [],
  market, postedAt: toISOOrNull(r.datePublished ?? r.dateOnIndeed),
});

/**
 * ninz~my-actor dataset → CanonicalJob. Mostaql = Arabic software freelance marketplace,
 * MENA-regional. No id or date field in the actor output; category may be a string or array.
 * Flag-gated OFF (JOBRADAR_ENABLE_MOSTAQL).
 */
const mostaqlMap = (r) => ({
  source: 'mostaql',
  externalId: null,
  title: r.title,
  company: null,
  location: 'MENA',
  remote: true,
  url: r.link,
  description: r.description ?? null,
  tags: Array.isArray(r.category) ? r.category : (r.category ? [r.category] : []),
  market: 'mena',
  postedAt: null,
});

/**
 * neatrat~upwork-job-scraper dataset → CanonicalJob. Upwork = global freelance marketplace.
 * Items include id, absoluteDate, relativeDate, clientName, clientLocation, tags.
 * Flag-gated OFF (JOBRADAR_ENABLE_UPWORK).
 */
const upworkMap = (r) => ({
  source: 'upwork',
  externalId: r.id != null ? String(r.id) : null,
  title: r.title,
  company: r.clientName ?? null,
  location: r.clientLocation || 'Remote',
  remote: true,
  url: r.url,
  description: r.description ?? null,
  tags: Array.isArray(r.tags) ? r.tags : [],
  market: 'global',
  postedAt: toISOOrNull(r.absoluteDate ?? r.relativeDate ?? r.date),
});

/** shahidirfan/Wellfound-Jobs-Scraper dataset → CanonicalJob. Wellfound (ex-AngelList) = startup jobs. */
const wellfoundMap = (r) => ({
  source: 'wellfound', externalId: r.id ?? null, title: r.title, company: r.company ?? null,
  location: r.location || null, remote: !!r.remote, url: r.applyUrl || r.companyUrl,
  description: r.description_text ?? stripHtml(r.description_html),
  tags: [r.primaryRoleTitle, r.jobType].filter(Boolean), market: 'global',
  // Wellfound's postedDate is a Unix timestamp in SECONDS; toISOOrNull treats a bare number as ms.
  postedAt: typeof r.postedDate === 'number' ? toISOOrNull(r.postedDate * 1000) : toISOOrNull(r.postedDate),
});

/**
 * Per-Apify-source count input key used to cap results for preview runs.
 * null/absent means the source has no count knob (page-based or category-based).
 */
export const SOURCE_LIMIT_KEYS = {
  bayt: 'results_wanted', wuzzuf: 'results_wanted', naukrigulf: 'maxResults',
  gulftalent: 'maxJobs', indeed: 'limit',
  linkedin: 'count',
  wellfound: 'results_wanted', upwork: null, mostaql: null,
};

/**
 * Build a MENA source that fans out over selected GCC countries and merges results.
 *
 * Each call to its `fetch(profile)`:
 *   1. Resolves the selected countries from `config.country` (array of GCC keys).
 *      If empty/absent, uses all 6 MENA_COUNTRIES.
 *   2. For each country row, builds + fetches that country's Apify actor call (via
 *      a per-country makeApifySource), then concatenates the mapped CanonicalJobs.
 *
 * Non-country filters still merge via applyFilters (inside perCountryBuildInput).
 * previewLimit caps each per-country call via its countKey.
 *
 * @param {{ name, market, actorId, token, config, perCountryBuildInput, map, fetchImpl, previewLimit, countKey }} opts
 * @returns {{ name, market, fetch(profile): Promise<CanonicalJob[]> }}
 */
export function makeMenaSource({ name, market = 'mena', actorId, token, config = {}, perCountryBuildInput, map, fetchImpl = fetch, previewLimit = null, countKey = null }) {
  // Strip the 'country' key from the config before forwarding to perCountryBuildInput:
  // 'country' is the GCC key selector for fan-out, not an actor input field — it must not
  // be merged into the actor's buildInput via applyFilters.
  const { country: _country, ...configWithoutCountry } = config;
  return {
    name,
    market,
    async fetch(profile) {
      // Resolve selected countries: config.country (array of GCC keys) or all 6.
      const selectedKeys = Array.isArray(config.country) && config.country.length > 0
        ? config.country
        : MENA_COUNTRIES.map((c) => c.key);
      let selectedCountries = selectedKeys
        .map((k) => MENA_COUNTRIES.find((c) => c.key === k))
        .filter(Boolean);
      // Defensive: if the config held only stale/invalid keys, don't silently
      // return nothing — fall back to all 6 GCC countries.
      if (selectedCountries.length === 0) selectedCountries = MENA_COUNTRIES.slice();

      // Preview: cap to first leg only to avoid spending all Apify quota on a preview run.
      if (previewLimit != null) selectedCountries = selectedCountries.slice(0, 1);

      // Fan out: one Apify call per country, then flatten.
      const allJobs = [];
      for (const countryRow of selectedCountries) {
        const perCountrySource = makeApifySource({
          name: `${name}-${countryRow.key}`,
          market,
          actorId,
          token,
          buildInput: (p) => perCountryBuildInput(countryRow, p, configWithoutCountry),
          map,
          fetchImpl,
          previewLimit,
          countKey,
        });
        const jobs = await perCountrySource.fetch(profile);
        allJobs.push(...jobs);
      }
      return allJobs;
    },
  };
}

/** Valid location keys for the location fan-out filter. */
const VALID_LOCATION_KEYS = new Set(['remote', 'uae', 'ksa', 'qatar', 'kuwait', 'bahrain', 'oman']);

/**
 * Build a source that fans out over a `location` filter (remote + GCC countries).
 *
 * The `location` config key is a multiselect array of values from:
 *   remote, uae, ksa, qatar, kuwait, bahrain, oman
 *
 * Default when unset/empty/all-invalid = ['remote'].
 * `location` is stripped from config before it reaches the actor (fan-out selector, not actor input).
 *
 * Each call to its `fetch(profile)`:
 *   - 'remote' leg → remoteBuildInput(profile, configWithoutLocation), mapped via mapFor('global')
 *   - GCC key leg → perCountryBuildInput(countryRow, profile, configWithoutLocation), mapped via mapFor('mena')
 *   - Results from all legs are concatenated.
 *
 * @param {{ name, actorId, token, config, remoteBuildInput, perCountryBuildInput, mapFor, fetchImpl, previewLimit, countKey }} opts
 * @returns {{ name, market, fetch(profile): Promise<CanonicalJob[]> }}
 */
export function makeLocationSource({ name, actorId, token, config = {}, remoteBuildInput, perCountryBuildInput, mapFor, fetchImpl = fetch, previewLimit = null, countKey = null }) {
  // Strip both 'location' and 'country' from config before forwarding to build inputs —
  // 'location' is the fan-out selector, 'country' is stale from MENA sources; neither
  // should reach the actor input field.
  const { location: _loc, country: _ctry, ...configWithoutFanout } = config;
  const configWithoutLocation = configWithoutFanout;

  return {
    name,
    market: 'global',  // The source itself spans both markets; individual jobs carry their own market.
    async fetch(profile) {
      // Resolve selected locations; validate against known keys; default to ['remote'].
      const rawLocs = Array.isArray(config.location) && config.location.length > 0
        ? config.location
        : ['remote'];
      let selectedLocs = rawLocs.filter((k) => VALID_LOCATION_KEYS.has(k));
      if (selectedLocs.length === 0) selectedLocs = ['remote'];

      // Preview: cap to first leg only to avoid spending all Apify quota on a preview run.
      if (previewLimit != null) selectedLocs = selectedLocs.slice(0, 1);

      const allJobs = [];
      for (const loc of selectedLocs) {
        if (loc === 'remote') {
          // Remote leg: worldwide search, market=global
          const remoteSrc = makeApifySource({
            name: `${name}-remote`,
            market: 'global',
            actorId,
            token,
            buildInput: (p) => remoteBuildInput(p, configWithoutLocation),
            map: mapFor('global'),
            fetchImpl,
            previewLimit,
            countKey,
          });
          const jobs = await remoteSrc.fetch(profile);
          allJobs.push(...jobs);
        } else {
          // GCC country leg: per-country search, market=mena
          const countryRow = MENA_COUNTRIES.find((c) => c.key === loc);
          if (!countryRow) continue; // guard (already filtered, but be safe)
          const countrySrc = makeApifySource({
            name: `${name}-${loc}`,
            market: 'mena',
            actorId,
            token,
            buildInput: (p) => perCountryBuildInput(countryRow, p, configWithoutLocation),
            map: mapFor('mena'),
            fetchImpl,
            previewLimit,
            countKey,
          });
          const jobs = await countrySrc.fetch(profile);
          allJobs.push(...jobs);
        }
      }
      return allJobs;
    },
  };
}

/**
 * Build the source registry from an env bag (lets tests vary the flags). fetchImpl
 * threads into the Apify sources for tests.
 *
 * Options:
 *  - forceMena / forceLinkedin / forceIndeed / forceWellfound: emit the MENA / LinkedIn /
 *    Indeed / Wellfound candidate set whenever the token is present, ignoring the
 *    JOBRADAR_ENABLE_* env flags. Used by the DB path (buildSourcesFromDb), where the DB
 *    family toggle — not the env flag — is the effective control. Token never bypassed (P3).
 *  - forceCareerjet: same as above for Careerjet, except its prerequisite is the free
 *    CAREERJET_AFFID (no Apify token) — never bypassed by the DB toggle.
 *  - previewLimit: when set, cap each Apify source's result count via its SOURCE_LIMIT_KEYS
 *    entry (if any). Free fetchers are not capped here — runPreview slices them post-fetch.
 *  - sourceConfigs: per-source config objects from the DB (keyed by source family name).
 */
export function buildSources(env = process.env, { fetchImpl, forceMena = false, forceLinkedin = false, forceIndeed = false, forceWellfound = false, forceCareerjet = false, forceMostaql = false, forceUpwork = false, sourceConfigs = {}, previewLimit = null } = {}) {
  const impl = fetchImpl || fetch;
  const list = [
    { name: 'remotive', market: 'global', fetch: (p) => fetchRemotive(p, impl, sourceConfigs.remotive) },
    { name: 'remoteok', market: 'global', fetch: fetchRemoteOk },
    { name: 'jobicy', market: 'global', fetch: (p) => fetchJobicy(p, impl, sourceConfigs.jobicy) },
    { name: 'arbeitnow', market: 'global', fetch: fetchArbeitnow },
    { name: 'weworkremotely', market: 'global', fetch: fetchWeWorkRemotely },
    { name: 'himalayas', market: 'global', fetch: fetchHimalayas },
    { name: 'hackernews', market: 'global', fetch: fetchHackerNews },
    { name: 'reddit', market: 'global', fetch: fetchReddit },
    { name: 'freelancer', market: 'global', fetch: fetchFreelancer },
  ];
  const token = env.APIFY_TOKEN;
  const menaOpts = (sourceName) => {
    const ck = SOURCE_LIMIT_KEYS[sourceName] ?? null;
    return { fetchImpl: impl, previewLimit: previewLimit ?? null, countKey: previewLimit != null ? ck : null };
  };

  // MENA sources (Bayt + NaukriGulf + GulfTalent + Wuzzuf) — flag-gated OFF.
  // Bayt, NaukriGulf, GulfTalent are now single makeMenaSource entries that fan out per country.
  // Wuzzuf remains per-country (per-loop) as it is Egypt-centric, not in the refactor scope.
  if (token && (forceMena || env.JOBRADAR_ENABLE_MENA === '1')) {
    list.push(makeMenaSource({
      name: 'bayt', market: 'mena', actorId: 'shahidirfan~bayt-jobs-scraper', token,
      config: sourceConfigs.bayt || {},
      // Bayt's actor only takes startUrl/results_wanted/max_pages/proxy (no applyFilters).
      // The keyword is baked into the startUrl — honor a per-source query override if set.
      perCountryBuildInput: (c, p, cfg) => ({
        startUrl: baytStartUrl(c.baytSlug, (cfg && cfg.query) || p.includeKeywords?.[0]),
        results_wanted: 80, max_pages: 5, proxyConfiguration: { useApifyProxy: true },
      }),
      map: baytMap,
      ...menaOpts('bayt'),
    }));

    list.push(makeMenaSource({
      name: 'naukrigulf', market: 'mena', actorId: 'blackfalcondata~naukrigulf-scraper', token,
      config: sourceConfigs.naukrigulf || {},
      perCountryBuildInput: (c, p, cfg) => applyFilters({ mode: 'search', query: p.includeKeywords?.[0] || 'software', location: c.loc, maxResults: 80 }, cfg),
      map: naukrigulfMap,
      ...menaOpts('naukrigulf'),
    }));

    list.push(makeMenaSource({
      name: 'gulftalent', market: 'mena', actorId: 'shahidirfan~GulfTalent-Job-Scraper', token,
      config: sourceConfigs.gulftalent || {},
      perCountryBuildInput: (c, p, cfg) => applyFilters({ keyword: p.includeKeywords?.[0] || 'software', location: c.city, maxJobs: 80, proxyConfiguration: { useApifyProxy: true } }, cfg),
      map: gulftalentMap,
      ...menaOpts('gulftalent'),
    }));

    // Wuzzuf stays as per-country loop (Egypt-centric, not in the per-source refactor scope).
    for (const c of MENA_COUNTRIES) {
      const extra = { fetchImpl: impl };
      if (previewLimit != null) {
        extra.previewLimit = previewLimit;
        extra.countKey = SOURCE_LIMIT_KEYS.wuzzuf ?? null;
      }
      list.push(makeApifySource({
        name: `wuzzuf-${c.key}`, market: 'mena', token, actorId: 'shahidirfan~wuzzuf-jobs-scraper',
        buildInput: (p) => ({
          keyword: p.includeKeywords?.[0] || 'software', location: c.loc,
          results_wanted: 80, max_pages: 5, maxJobAge: 'all', proxyConfiguration: { useApifyProxy: false },
        }),
        map: wuzzufMap,
        ...extra,
      }));
    }
  }

  // LinkedIn (curious_coder/linkedin-jobs-scraper) — public guest search, no cookie.
  // Unified source: `location` config key selects remote (global) and/or GCC country legs.
  if (token && (forceLinkedin || env.JOBRADAR_ENABLE_LINKEDIN === '1')) {
    const count = Number(env.JOBRADAR_LINKEDIN_COUNT || 50);
    const ck = SOURCE_LIMIT_KEYS.linkedin ?? null;
    list.push(makeLocationSource({
      name: 'linkedin',
      actorId: 'curious_coder~linkedin-jobs-scraper',
      token,
      config: sourceConfigs.linkedin || {},
      remoteBuildInput: (p, cfg) => applyFilters({ urls: [linkedinSearchUrl(p.includeKeywords?.[0], { remote: true })], count }, cfg),
      perCountryBuildInput: (c, p, cfg) => applyFilters({ urls: [linkedinSearchUrl(p.includeKeywords?.[0], { loc: c.loc })], count }, cfg),
      mapFor: linkedinMap,
      fetchImpl: impl,
      ...(previewLimit != null ? { previewLimit, countKey: ck } : {}),
    }));
  }

  // Indeed (valig/indeed-jobs-scraper) — wide-net fallback spanning both legs in one
  // actor. Unified source: `location` config key selects remote (global) and/or GCC country legs.
  if (token && (forceIndeed || env.JOBRADAR_ENABLE_INDEED === '1')) {
    const ck = SOURCE_LIMIT_KEYS.indeed ?? null;
    list.push(makeLocationSource({
      name: 'indeed',
      actorId: 'valig~indeed-jobs-scraper',
      token,
      config: sourceConfigs.indeed || {},
      remoteBuildInput: (p, cfg) => applyFilters({ title: p.includeKeywords?.[0] || 'software', country: 'us', location: 'Remote', limit: 80 }, cfg),
      perCountryBuildInput: (c, p, cfg) => applyFilters({ title: p.includeKeywords?.[0] || 'software', country: c.iso2.toLowerCase(), limit: 80 }, cfg),
      mapFor: indeedMap,
      fetchImpl: impl,
      ...(previewLimit != null ? { previewLimit, countKey: ck } : {}),
    }));
  }

  // Wellfound (shahidirfan/Wellfound-Jobs-Scraper) — startup jobs, remote-worldwide.
  // Paid + heavily bot-protected (residential proxy). Own family toggle, OFF by default.
  if (token && (forceWellfound || env.JOBRADAR_ENABLE_WELLFOUND === '1')) {
    list.push(makeApifySource({
      name: 'wellfound', market: 'global', token, actorId: 'shahidirfan~Wellfound-Jobs-Scraper',
      buildInput: (p) => applyFilters({ keyword: p.includeKeywords?.[0] || 'software', results_wanted: 80, proxyConfiguration: { useApifyProxy: true, apifyProxyGroups: ['RESIDENTIAL'] } }, sourceConfigs.wellfound),
      map: wellfoundMap,
      fetchImpl: impl,
      ...(previewLimit != null ? { previewLimit, countKey: SOURCE_LIMIT_KEYS.wellfound } : {}),
    }));
  }

  // Mostaql (ninz~my-actor) — Arabic software freelance marketplace; MENA-regional.
  // No id or date field in actor output. Own family toggle, OFF by default.
  if (token && (forceMostaql || env.JOBRADAR_ENABLE_MOSTAQL === '1')) {
    list.push(makeApifySource({
      name: 'mostaql', market: 'mena', token, actorId: 'ninz~my-actor',
      buildInput: () => applyFilters({ category: ['development'] }, sourceConfigs.mostaql),
      map: mostaqlMap,
      fetchImpl: impl,
    }));
  }

  // Upwork (neatrat~upwork-job-scraper) — global freelance marketplace.
  // Own family toggle, OFF by default.
  if (token && (forceUpwork || env.JOBRADAR_ENABLE_UPWORK === '1')) {
    list.push(makeApifySource({
      name: 'upwork', market: 'global', token, actorId: 'neatrat~upwork-job-scraper',
      buildInput: (p) => applyFilters({ query: p.includeKeywords?.[0] || 'software developer', page: 1 }, sourceConfigs.upwork),
      map: upworkMap,
      fetchImpl: impl,
    }));
  }

  // Careerjet — FREE aggregator search API (no Apify token; gated on its own free
  // affiliate id, CAREERJET_AFFID). One entry per GCC country, each a plain fetch
  // into fetchCareerjet with its locale + location. Own family toggle, OFF by default.
  const affid = env.CAREERJET_AFFID;
  if (affid && (forceCareerjet || env.JOBRADAR_ENABLE_CAREERJET === '1')) {
    for (const c of MENA_COUNTRIES) {
      const localeCode = CAREERJET_LOCALES[c.key] || 'en_AE';
      const location = c.loc;
      list.push({
        name: `careerjet-${c.key}`,
        market: 'mena',
        fetch: (p) => fetchCareerjet(p, impl, { affid, localeCode, location }, sourceConfigs.careerjet),
      });
    }
  }

  return list;
}

/**
 * DB-aware source builder: layers the UI discovery config (source family toggles +
 * sourceConfigs) on top of the env-built list.
 *
 * Semantics (see spec §6.3):
 *  - client null OR DB/table absent OR JOBRADAR_TENANT_ID unset → loadDiscoveryConfig
 *    yields all-null → behaves exactly like buildSources(env) (P1/P2). The
 *    JOBRADAR_ENABLE_* flags gate this fallback path. (C2: config now lives in
 *    tenant_source_config, scoped to JOBRADAR_TENANT_ID — the engine stays
 *    single-tenant, reading only the owner's config.)
 *  - DB config present → the MENA/LinkedIn candidate set is emitted whenever the
 *    APIFY_TOKEN is present (env enable flags no longer gate it), then filtered by
 *    the DB family toggle via applySourceToggles. The token prerequisite is never
 *    bypassed, so toggling a paid source ON without a token still yields nothing (P3).
 *  - Country subsetting is now per-source (via config.country in each MENA source's
 *    DB config), not a global country filter. The discovery_countries table is left
 *    in place but unused.
 *
 * Options (beyond the buildSources opts):
 *  - respectCadence (default false): when true, after the enabled-toggle filter, also drop
 *    any source whose family is not yet due per isSourceDue (uses sourceRows from loadDiscoveryConfig).
 *    When false (preview / manual run), all enabled sources are kept regardless of cadence.
 */
export async function buildSourcesFromDb(env = process.env, client, opts = {}) {
  const cfg = client
    ? await loadDiscoveryConfig(client, Number(env.JOBRADAR_TENANT_ID) || undefined)
    : { sources: null, excludes: null };
  const hasDbConfig = cfg.sources != null; // tables present (even if empty) → DB path
  const { respectCadence = false, ...buildOpts } = opts;
  const envBuilt = buildSources(env, {
    ...buildOpts,
    // With DB config present, the family toggle is the effective control: emit the
    // candidate paid set when the token exists, then let applySourceToggles filter.
    forceMena: hasDbConfig,
    forceLinkedin: hasDbConfig,
    forceIndeed: hasDbConfig,
    forceWellfound: hasDbConfig,
    forceCareerjet: hasDbConfig,
    forceMostaql: hasDbConfig,
    forceUpwork: hasDbConfig,
    sourceConfigs: cfg.sourceConfigs || {},
    previewLimit: buildOpts.previewLimit ?? null,
  });
  const toggled = applySourceToggles(envBuilt, cfg.sources);
  if (!respectCadence || !cfg.sourceRows) return toggled;
  // Cadence filter: drop sources whose family is not yet due.
  const now = new Date();
  return toggled.filter((s) => {
    const fam = familyOf(s.name);
    const row = cfg.sourceRows.get(fam);
    return isSourceDue(row ?? {}, now);
  });
}

export const SOURCES = buildSources(process.env);
