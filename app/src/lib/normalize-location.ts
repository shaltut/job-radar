/**
 * Deterministic, rules-based normalizer for `jobs.location`.
 *
 * NOT AI — purely string rules built from the actual distinct values observed
 * in the `jobs` table (see `.superpowers/sdd/feat-117-report.md` for the full
 * cluster analysis this table was built from).
 *
 * Canonical output shapes, in priority order:
 *   1. `null`             — null / empty / whitespace-only input
 *   2. `"Remote"`         — remote-with-no-country-signal
 *   3. `"Remote, Country"` — remote listings that also name exactly one country
 *   4. `"Country"`        — a single recognized country with no city part
 *   5. `"City, Country"`  — a recognized city + exactly one recognized country
 *   6. a bare city        — a cleaned place name with no resolvable country
 *   7. the trimmed original — ambiguous / multi-place / unrecognized input
 *
 * The algorithm is intentionally conservative: whenever more than one
 * candidate place remains after alias-resolution and de-duplication, it
 * refuses to guess and returns the input unchanged (trimmed/whitespace
 * collapsed) rather than risk merging two distinct locations into one.
 * Never throws, never silently drops data.
 */

// ---------------------------------------------------------------------------
// Alias tables — built from the enumerated `jobs.location` data.
// ---------------------------------------------------------------------------

/**
 * Country aliases → ONE canonical country name. Keys are lowercased.
 * Includes: common abbreviations, ISO 3166-1 alpha-3 codes seen in the data
 * (ARE/SAU/MAR/NLD/CHE), the Arabic name for Saudi Arabia, and a "Hong Kong
 * SAR" → "Hong Kong" collapse. Every plain country name that appears literally
 * in the data is also self-mapped so it is recognized as a "country" segment.
 */
const COUNTRY_ALIASES: Record<string, string> = {
  // United Arab Emirates
  "uae": "United Arab Emirates",
  "u.a.e.": "United Arab Emirates",
  "u.a.e": "United Arab Emirates",
  "united arab emirates": "United Arab Emirates",
  "are": "United Arab Emirates", // ISO 3166-1 alpha-3

  // Saudi Arabia
  "ksa": "Saudi Arabia",
  "saudi arabia": "Saudi Arabia",
  "kingdom of saudi arabia": "Saudi Arabia",
  "sau": "Saudi Arabia", // ISO 3166-1 alpha-3
  "المملكة العربية السعودية": "Saudi Arabia", // Arabic: "Kingdom of Saudi Arabia"

  // United States
  "usa": "United States",
  "us": "United States",
  "u.s.": "United States",
  "u.s.a.": "United States",
  "united states": "United States",
  "united states of america": "United States",

  // United Kingdom
  "uk": "United Kingdom",
  "u.k.": "United Kingdom",
  "united kingdom": "United Kingdom",
  "great britain": "United Kingdom",

  // ISO alpha-3 codes seen bare in the data
  "mar": "Morocco",
  "nld": "Netherlands",
  "che": "Switzerland",

  // Hong Kong
  "hong kong": "Hong Kong",
  "hong kong sar": "Hong Kong",

  // Plain country names, self-mapped so they're recognized as "country" segments
  "egypt": "Egypt",
  "canada": "Canada",
  "india": "India",
  "germany": "Germany",
  "ukraine": "Ukraine",
  "brazil": "Brazil",
  "poland": "Poland",
  "pakistan": "Pakistan",
  "qatar": "Qatar",
  "oman": "Oman",
  "bahrain": "Bahrain",
  "kuwait": "Kuwait",
  "jordan": "Jordan",
  "israel": "Israel",
  "cyprus": "Cyprus",
  "greece": "Greece",
  "spain": "Spain",
  "austria": "Austria",
  "finland": "Finland",
  "latvia": "Latvia",
  "romania": "Romania",
  "lithuania": "Lithuania",
  "netherlands": "Netherlands",
  "switzerland": "Switzerland",
  "norway": "Norway",
  "denmark": "Denmark",
  "iceland": "Iceland",
  "philippines": "Philippines",
  "bangladesh": "Bangladesh",
  "indonesia": "Indonesia",
  "singapore": "Singapore",
  "china": "China",
  "south africa": "South Africa",
  "mexico": "Mexico",
  "guatemala": "Guatemala",
  "panama": "Panama",
  "costa rica": "Costa Rica",
  "el salvador": "El Salvador",
  "uruguay": "Uruguay",
  "argentina": "Argentina",
  "andorra": "Andorra",
  "morocco": "Morocco",
  "australia": "Australia",
  "ireland": "Ireland",
}

/**
 * City-name aliases (non-English spellings, alternate spellings, "X City" →
 * "X") → ONE canonical city name. Keys are lowercased.
 */
const CITY_ALIASES: Record<string, string> = {
  "new york city": "New York",
  // Arabic city names seen in the data (all paired with the Arabic KSA
  // country name above)
  "الرياض": "Riyadh",
  "الخبر": "Al Khobar",
  "جدة": "Jeddah",
  "تبوك": "Tabuk",
}

/**
 * Bare-city → country gazetteer, used ONLY when a raw value reduces to a
 * single leftover place segment with no explicit country anywhere in the
 * string (e.g. "Riyadh" alone, "Berlin" alone). Scoped to cities actually
 * observed bare in `jobs.location` — extend as new bare cities show up.
 * Keys are lowercased canonical city text (post CITY_ALIASES resolution).
 */
const CITY_TO_COUNTRY: Record<string, string> = {
  // Gulf (NOTE: "makkah"/"mecca" are NOT here — they're provinces, see
  // PROVINCE_TO_COUNTRY below, so "Jeddah, Makkah" keeps "Jeddah" as the city)
  "riyadh": "Saudi Arabia",
  "jeddah": "Saudi Arabia",
  "al khobar": "Saudi Arabia",
  "dubai": "United Arab Emirates",
  "abu dhabi": "United Arab Emirates",
  "sharjah": "United Arab Emirates",
  "muscat": "Oman",
  // Germany (many small-town job sources return bare city, no country)
  "berlin": "Germany",
  "bremen": "Germany",
  "frankfurt am main": "Germany",
  "nuremberg": "Germany",
  "dresden": "Germany",
  "saarbrücken": "Germany",
  "munich": "Germany",
  "leipzig": "Germany",
  "rosenheim": "Germany",
  "hanover": "Germany",
  "neuss": "Germany",
  "duisburg": "Germany",
  "mönchengladbach": "Germany",
  "frechen": "Germany",
  "eschborn": "Germany",
  "fulda": "Germany",
  "oldenburg": "Germany",
  "rostock": "Germany",
  "saerbeck": "Germany",
  "neumarkt in der oberpfalz": "Germany",
  "brieskow-finkenheerd": "Germany",
  // United States
  "new york": "United States",
  "san francisco": "United States",
  "santa monica": "United States",
  "boston": "United States",
  "mountain view": "United States",
  "los angeles": "United States",
  "san diego": "United States",
  "denver": "United States",
  "philadelphia": "United States",
  "columbus": "United States",
  "brooklyn": "United States",
  "washington": "United States",
  "austin": "United States",
  "san francisco bay": "United States",
  // India
  "surat": "India",
  // United Kingdom (NOTE: NOT "birmingham" — it's UK/US-ambiguous bare, so
  // it's deliberately left unresolvable, preserving the "never guess" rule)
  "bristol": "United Kingdom",
}

/**
 * US state gazetteer (round-2): a bare 2-letter postal code OR full state
 * name (plus DC variants) resolves to the country "United States". Keys are
 * lowercased. Deliberately EXCLUDES the full names "new york" and
 * "washington" — those collide with the dominant bare-city usage of those
 * words in the data (New York City / Washington D.C.) and are instead
 * resolved as ordinary cities via CITY_TO_COUNTRY, so multi-city lists like
 * "Los Angeles, New York" still count as 2 real cities rather than 1 city +
 * 1 state token.
 */
const US_STATE = new Set<string>([
  // 2-letter postal codes (all 50 + DC)
  "al", "ak", "az", "ar", "ca", "co", "ct", "de", "fl", "ga",
  "hi", "id", "il", "in", "ia", "ks", "ky", "la", "me", "md",
  "ma", "mi", "mn", "ms", "mo", "mt", "ne", "nv", "nh", "nj",
  "nm", "ny", "nc", "nd", "oh", "ok", "or", "pa", "ri", "sc",
  "sd", "tn", "tx", "ut", "vt", "va", "wa", "wv", "wi", "wy",
  "dc",
  // Full state names (all 50 except "new york" and "washington" — see above)
  "alabama", "alaska", "arizona", "arkansas", "california", "colorado",
  "connecticut", "delaware", "florida", "georgia", "hawaii", "idaho",
  "illinois", "indiana", "iowa", "kansas", "kentucky", "louisiana",
  "maine", "maryland", "massachusetts", "michigan", "minnesota",
  "mississippi", "missouri", "montana", "nebraska", "nevada",
  "new hampshire", "new jersey", "new mexico", "north carolina",
  "north dakota", "ohio", "oklahoma", "oregon", "pennsylvania",
  "rhode island", "south carolina", "south dakota", "tennessee", "texas",
  "utah", "vermont", "virginia", "west virginia", "wisconsin", "wyoming",
  // DC variants
  "washington dc", "district of columbia",
])

/**
 * MENA province/region → country gazetteer (round-2). A segment matching
 * one of these resolves directly to its country, e.g. "Jeddah, Makkah" →
 * the "Makkah" segment resolves to Saudi Arabia so the final result keeps
 * "Jeddah" as the city. Keys are lowercased.
 */
const PROVINCE_TO_COUNTRY: Record<string, string> = {
  "makkah": "Saudi Arabia",
  "mecca": "Saudi Arabia",
  "riyadh province": "Saudi Arabia",
  "eastern province": "Saudi Arabia",
  "madinah": "Saudi Arabia",
}

/** Trailing admin-division words observed as noise suffixes in the data. */
const ADMIN_SUFFIX_RE = /\s+(Emirate|Region|Division|Area|Province)$/i

/** Remote-only phrases matched as the WHOLE (trimmed, lowercased) string. */
const REMOTE_ONLY_PHRASES = new Set([
  "remote",
  "anywhere in the world",
  "anywhere",
  "worldwide",
  "fully remote",
  "100% remote",
])

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function collapseWs(s: string): string {
  return s.replace(/\s+/g, " ").trim()
}

/** Split on `,` `|` `·` `(` `)` always, and on `-`/`–`/`—` only when it is
 * flanked by whitespace (so compound names like "Al-Khaimah" or
 * "Brieskow-Finkenheerd" are NOT split apart). */
function splitSegments(s: string): string[] {
  return s
    .split(/\s*[,|·]\s*|\s*[()]\s*|\s+[-–—]+\s+/g)
    .map((seg) => seg.trim())
    .filter(Boolean)
}

/** Strip a trailing zip/postal-code-like run of 3+ digits, e.g. "IA 50131" → "IA". */
function stripTrailingZip(s: string): string {
  return s.replace(/\s+\d{3,}$/, "").trim()
}

/** Title-case a segment ONLY if it arrived uniformly-cased (ALL CAPS or all
 * lowercase); text that is already mixed-case (e.g. "Frankfurt am Main",
 * "Kingston Upon Thames") is trusted as-is rather than re-cased. */
function smartTitleCase(s: string): string {
  const isAllUpper = s === s.toUpperCase()
  const isAllLower = s === s.toLowerCase()
  if (!isAllUpper && !isAllLower) return s
  return s.toLowerCase().replace(/\b\p{L}/gu, (c) => c.toUpperCase())
}

/**
 * "region" is a NEW round-2 kind distinct from "country": it's a US
 * state/DC token or a MENA province token that unambiguously implies one
 * country, but (unlike a genuine `COUNTRY_ALIASES` match) it must NOT feed
 * the top-level single/multi-country check below — that check is reserved
 * for literal country names so round-1's "drop the noise middle segment"
 * behavior (e.g. "London, England, United Kingdom" → "London, United
 * Kingdom") stays untouched. Region tokens are handled entirely by the
 * round-2 "no explicit country" branch further down.
 */
type Kind = "country" | "region" | "city" | "unknown"
// `country` is set ONLY for region tokens (US state / MENA province): it carries
// the country the region implies, while `text` keeps the region's own name so a
// region paired with an explicit country (e.g. "Makkah, Saudi Arabia") is treated
// as the CITY and not collapsed away.
interface Resolved { text: string; kind: Kind; country?: string }

/** Resolve one cleaned segment against the alias tables, trying the
 * admin-suffix-stripped form if there's no direct match. */
function resolveSegment(raw: string): Resolved | null {
  const cleaned = stripTrailingZip(collapseWs(raw))
  if (!cleaned) return null

  const key = cleaned.toLowerCase()
  if (COUNTRY_ALIASES[key]) return { text: COUNTRY_ALIASES[key], kind: "country" }
  if (CITY_ALIASES[key]) return { text: CITY_ALIASES[key], kind: "city" }
  if (US_STATE.has(key)) return { text: smartTitleCase(cleaned), kind: "region", country: "United States" }
  if (PROVINCE_TO_COUNTRY[key]) return { text: smartTitleCase(cleaned), kind: "region", country: PROVINCE_TO_COUNTRY[key] }

  const stripped = cleaned.replace(ADMIN_SUFFIX_RE, "").trim()
  if (stripped && stripped !== cleaned) {
    const strippedKey = stripped.toLowerCase()
    if (COUNTRY_ALIASES[strippedKey]) return { text: COUNTRY_ALIASES[strippedKey], kind: "country" }
    if (CITY_ALIASES[strippedKey]) return { text: CITY_ALIASES[strippedKey], kind: "city" }
    if (US_STATE.has(strippedKey)) return { text: smartTitleCase(stripped), kind: "region", country: "United States" }
    if (PROVINCE_TO_COUNTRY[strippedKey]) return { text: smartTitleCase(stripped), kind: "region", country: PROVINCE_TO_COUNTRY[strippedKey] }
    return { text: smartTitleCase(stripped), kind: "unknown" }
  }

  return { text: smartTitleCase(cleaned), kind: "unknown" }
}

/** De-duplicate resolved segments by case-insensitive text, keeping first occurrence. */
function dedupe(items: Resolved[]): Resolved[] {
  const seen = new Set<string>()
  const out: Resolved[] = []
  for (const item of items) {
    const key = item.text.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function normalizeLocation(raw: string | null): string | null {
  if (raw == null) return null

  const trimmedOriginal = collapseWs(raw)
  if (!trimmedOriginal) return null

  const wholeLower = trimmedOriginal.toLowerCase()
  if (REMOTE_ONLY_PHRASES.has(wholeLower)) return "Remote"

  const rawSegments = splitSegments(trimmedOriginal)
  if (rawSegments.length === 0) return trimmedOriginal

  const isRemotePrefixed = rawSegments[0].toLowerCase() === "remote"
  const workingRaw = isRemotePrefixed ? rawSegments.slice(1) : rawSegments

  if (isRemotePrefixed && workingRaw.length === 0) return "Remote"

  const resolved = dedupe(
    workingRaw
      .map((seg) => resolveSegment(seg))
      .filter((x): x is Resolved => x !== null)
  )

  if (resolved.length === 0) return isRemotePrefixed ? "Remote" : trimmedOriginal

  const countries = dedupe(resolved.filter((s) => s.kind === "country"))

  if (countries.length > 1) {
    // Genuinely ambiguous multi-country listing — never guess.
    return isRemotePrefixed ? "Remote" : trimmedOriginal
  }

  if (countries.length === 1) {
    const country = countries[0].text
    if (isRemotePrefixed) return `Remote, ${country}`

    const nonCountry = resolved.filter((s) => s.kind !== "country")
    if (nonCountry.length === 0) return country

    const cityPart = nonCountry[0].text // Rule A: drop all middle segments unconditionally
    if (cityPart.toLowerCase() === country.toLowerCase()) return country
    return `${cityPart}, ${country}`
  }

  // No explicit ISO-country segment found (round-2: guarantee a country).
  if (isRemotePrefixed) return "Remote"

  const regions = resolved.filter((s) => s.kind === "region")
  const regionCountrySet = dedupe(regions.map((r) => ({ text: r.country as string, kind: "country" as Kind })))

  if (regionCountrySet.length > 1) {
    // Conflicting state/province signals implying different countries —
    // never guess.
    return trimmedOriginal
  }

  if (regionCountrySet.length === 1) {
    // A US state / MENA province token establishes exactly one country.
    // Every NON-region segment is a place within that country — no gazetteer
    // lookup required (e.g. "Johnston, IA" keeps "Johnston" as the city
    // even though it isn't in CITY_TO_COUNTRY). The region token itself is a
    // qualifier and is dropped ("Jeddah, Makkah" → "Jeddah, Saudi Arabia").
    const country = regionCountrySet[0].text
    const cities = resolved.filter((s) => s.kind !== "region")
    if (cities.length === 0) return country
    if (cities.length === 1) return `${cities[0].text}, ${country}`
    // 2+ genuine cities under the same established country — collapse.
    return country
  }

  // No region/country token at all: every remaining segment must resolve to
  // a country via the bare-city gazetteer, or we bail (conservative — this
  // is what keeps "Birmingham"/"Springfield"/"European Union" unresolved).
  const derivedCountries: string[] = []
  for (const seg of resolved) {
    const country = CITY_TO_COUNTRY[seg.text.toLowerCase()]
    if (!country) return trimmedOriginal // unresolvable place — never guess
    derivedCountries.push(country)
  }

  const distinctCountries = dedupe(derivedCountries.map((text) => ({ text, kind: "country" as Kind })))
  if (distinctCountries.length > 1) {
    // Multiple distinct countries among the bare cities — never guess.
    return trimmedOriginal
  }

  const country = distinctCountries[0].text
  if (resolved.length === 1) return `${resolved[0].text}, ${country}`
  // 2+ bare cities that all resolve to the same single country — collapse.
  return country
}
