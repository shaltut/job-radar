/**
 * source-filters-manifest — static render manifest for per-source filter controls.
 *
 * Each FilterDef's `key` is the actor input key (what gets persisted in
 * sources.config and spread into the actor/API call by the engine).
 * The manifest is imported directly by the UI — no API endpoint needed.
 *
 * To add filter support for a new source: add an entry to SOURCE_FILTERS.
 * Sources not listed here fall back to DEFAULT_FILTERS (query only).
 *
 * `optionLabels` provides human-readable display labels for multiselect/select
 * options whose raw API values are opaque codes (e.g. "p" → "Permanent").
 * The raw value is always stored/sent; the label is display-only.
 */

export type FilterDef = {
  key: string
  label: string
  type: "text" | "number" | "bool" | "multiselect" | "select" | "range" | "tags"
  options?: string[]
  /** Human-readable display label for each option value (display-only; raw value is stored). */
  optionLabels?: Record<string, string>
  hint?: string
  /** Engine default for this filter (display-only — the panel never auto-writes this; the engine applies it when the config key is absent). */
  default?: string | number | boolean | string[]
}

/** Friendly display labels for GCC country keys (used by the UI for country multiselects). */
export const GCC_COUNTRY_LABELS: Record<string, string> = {
  uae: "UAE",
  ksa: "Saudi Arabia",
  qatar: "Qatar",
  kuwait: "Kuwait",
  bahrain: "Bahrain",
  oman: "Oman",
}

/**
 * ISO 3166-1 alpha-2 → country name lookup. Retained as a reference table for any
 * future country-coded filter (Indeed's country filter was replaced by `location`).
 */
export const ISO2_COUNTRY_NAMES: Record<string, string> = {
  AE: "United Arab Emirates",
  AR: "Argentina",
  AU: "Australia",
  AT: "Austria",
  BH: "Bahrain",
  BE: "Belgium",
  BR: "Brazil",
  CA: "Canada",
  CL: "Chile",
  CN: "China",
  CO: "Colombia",
  CR: "Costa Rica",
  CZ: "Czech Republic",
  DK: "Denmark",
  EC: "Ecuador",
  EG: "Egypt",
  FI: "Finland",
  FR: "France",
  DE: "Germany",
  GR: "Greece",
  HK: "Hong Kong",
  HU: "Hungary",
  IN: "India",
  ID: "Indonesia",
  IE: "Ireland",
  IL: "Israel",
  IT: "Italy",
  JP: "Japan",
  KW: "Kuwait",
  LU: "Luxembourg",
  MX: "Mexico",
  MA: "Morocco",
  NL: "Netherlands",
  NZ: "New Zealand",
  NG: "Nigeria",
  NO: "Norway",
  OM: "Oman",
  PK: "Pakistan",
  PA: "Panama",
  PE: "Peru",
  PH: "Philippines",
  PL: "Poland",
  PT: "Portugal",
  QA: "Qatar",
  RO: "Romania",
  SA: "Saudi Arabia",
  SG: "Singapore",
  ZA: "South Africa",
  KR: "South Korea",
  ES: "Spain",
  SE: "Sweden",
  CH: "Switzerland",
  TW: "Taiwan",
  TH: "Thailand",
  TR: "Turkey",
  UA: "Ukraine",
  GB: "United Kingdom",
  US: "United States",
  UY: "Uruguay",
  VE: "Venezuela",
  VN: "Vietnam",
}

const GCC_COUNTRY_FILTER: FilterDef = {
  key: "country",
  label: "Countries",
  type: "multiselect",
  options: ["uae", "ksa", "qatar", "kuwait", "bahrain", "oman"],
  optionLabels: GCC_COUNTRY_LABELS,
  default: ["uae", "ksa", "qatar", "kuwait", "bahrain", "oman"],
  hint: "Which Gulf countries to search. Defaults to all 6.",
}

export const SOURCE_FILTERS: Record<string, FilterDef[]> = {
  upwork: [
    { key: "query", label: "Search keywords", type: "text", hint: "A search phrase; words are AND'd. Not comma-separated." },
    {
      key: "experienceLevel",
      label: "Experience level",
      type: "multiselect",
      options: ["entry", "intermediate", "expert"],
      optionLabels: { entry: "Entry level", intermediate: "Intermediate", expert: "Expert" },
    },
    {
      key: "jobType",
      label: "Job type",
      type: "multiselect",
      options: ["hourly", "fixed"],
      optionLabels: { hourly: "Hourly", fixed: "Fixed price" },
    },
    { key: "paymentVerified", label: "Payment-verified clients only", type: "bool" },
    { key: "hourlyRateRange", label: "Hourly rate (min–max USD)", type: "range" },
    { key: "fixedPriceRange", label: "Fixed price (min–max USD)", type: "range" },
    { key: "location", label: "Client location(s)", type: "tags", hint: "Comma-separated countries or regions." },
  ],

  indeed: [
    { key: "title", label: "Keywords / Job title", type: "text", hint: "Search terms; words AND'd. Defaults to your résumé keywords if blank." },
    {
      key: "location",
      label: "Locations",
      type: "multiselect",
      options: ["remote", "uae", "ksa", "qatar", "kuwait", "bahrain", "oman"],
      optionLabels: { remote: "Remote", uae: "UAE", ksa: "Saudi Arabia", qatar: "Qatar", kuwait: "Kuwait", bahrain: "Bahrain", oman: "Oman" },
      default: ["remote"],
      hint: "Where to search. Remote = worldwide remote; pick Gulf countries to also search there.",
    },
  ],

  linkedin: [
    { key: "count", label: "Max jobs to fetch", type: "number", default: 50, hint: "Limit how many job listings the actor returns." },
    { key: "scrapeCompany", label: "Scrape company details", type: "bool" },
    {
      key: "location",
      label: "Locations",
      type: "multiselect",
      options: ["remote", "uae", "ksa", "qatar", "kuwait", "bahrain", "oman"],
      optionLabels: { remote: "Remote", uae: "UAE", ksa: "Saudi Arabia", qatar: "Qatar", kuwait: "Kuwait", bahrain: "Bahrain", oman: "Oman" },
      default: ["remote"],
      hint: "Where to search. Remote = worldwide remote; pick Gulf countries to also search there.",
    },
  ],

  wellfound: [
    { key: "keyword", label: "Keywords", type: "text", hint: "A search phrase. Defaults to your résumé keywords if blank." },
    { key: "location", label: "Location", type: "text", hint: "City or region (optional)." },
  ],

  gulftalent: [
    { key: "keyword", label: "Keywords", type: "text", hint: "A search phrase. Defaults to your résumé keywords if blank." },
    { key: "posted_date", label: "Posted", type: "select", options: ["anytime", "24h", "7d", "30d"], optionLabels: { anytime: "Any time", "24h": "Last 24 hours", "7d": "Last 7 days", "30d": "Last 30 days" }, default: "anytime" },
    GCC_COUNTRY_FILTER,
  ],

  naukrigulf: [
    { key: "query", label: "Keywords", type: "text", hint: "A phrase, e.g. \"civil engineer\". Defaults to your résumé keywords if blank." },
    GCC_COUNTRY_FILTER,
  ],

  bayt: [
    { key: "query", label: "Keywords", type: "text", hint: "Overrides the Bayt search keyword. Defaults to your résumé keywords if blank." },
    GCC_COUNTRY_FILTER,
  ],

  mostaql: [
    {
      key: "category",
      label: "Job categories",
      type: "multiselect",
      options: [
        "business", "development", "ai-machine-learning", "engineering-architecture",
        "design", "marketing", "writing-translation", "support", "training",
      ],
      optionLabels: {
        business: "Business",
        development: "Development",
        "ai-machine-learning": "AI & Machine Learning",
        "engineering-architecture": "Engineering & Architecture",
        design: "Design",
        marketing: "Marketing",
        "writing-translation": "Writing & Translation",
        support: "Support",
        training: "Training",
      },
      default: ["development"],
    },
  ],

  remotive: [
    { key: "search", label: "Keyword", type: "text", hint: "A search phrase (substring match). No commas or operators." },
    {
      key: "category",
      label: "Category",
      type: "multiselect",
      options: [
        "software-development", "artificial-intelligence", "data", "devops",
        "engineering", "information-technology", "qa", "product", "project-management",
        "design", "marketing", "sales", "customer-service", "finance", "human-resources",
        "writing", "legal", "medical", "education", "account-management",
        "business-development", "communications", "compliance", "knowledge-management",
        "operations", "research", "strategy", "supply-chain", "travel-hospitality",
        "all-others",
      ],
      optionLabels: {
        "software-development": "Software Development",
        "artificial-intelligence": "Artificial Intelligence",
        data: "Data",
        devops: "DevOps",
        engineering: "Engineering",
        "information-technology": "Information Technology",
        qa: "QA",
        product: "Product",
        "project-management": "Project Management",
        design: "Design",
        marketing: "Marketing",
        sales: "Sales",
        "customer-service": "Customer Service",
        finance: "Finance",
        "human-resources": "Human Resources",
        writing: "Writing",
        legal: "Legal",
        medical: "Medical",
        education: "Education",
        "account-management": "Account Management",
        "business-development": "Business Development",
        communications: "Communications",
        compliance: "Compliance",
        "knowledge-management": "Knowledge Management",
        operations: "Operations",
        research: "Research",
        strategy: "Strategy",
        "supply-chain": "Supply Chain",
        "travel-hospitality": "Travel & Hospitality",
        "all-others": "All Others",
      },
    },
  ],

  jobicy: [
    { key: "tag", label: "Keyword", type: "text", default: "backend", hint: "One word only — multiple words return nothing." },
    {
      key: "geo",
      label: "Region",
      type: "multiselect",
      options: ["usa", "canada", "uk", "europe", "latam", "emea", "apac"],
      optionLabels: {
        usa: "USA",
        canada: "Canada",
        uk: "UK",
        europe: "Europe",
        latam: "Latin America",
        emea: "EMEA",
        apac: "APAC",
      },
      default: ["usa", "canada", "europe"],
    },
    {
      key: "industry",
      label: "Industry / Category",
      type: "multiselect",
      options: [
        "dev", "cybersecurity", "data-science", "design-multimedia", "engineering",
        "qa-testing", "web-app-design", "technical-support", "marketing", "seo", "smm",
        "management", "project-management", "accounting-finance", "admin", "business",
        "copywriting", "e-commerce", "education", "healthcare", "hr", "legal",
        "supporting", "translation-localization", "video-audio-production",
      ],
      optionLabels: {
        dev: "Development",
        cybersecurity: "Cybersecurity",
        "data-science": "Data Science",
        "design-multimedia": "Design & Multimedia",
        engineering: "Engineering",
        "qa-testing": "QA & Testing",
        "web-app-design": "Web & App Design",
        "technical-support": "Technical Support",
        marketing: "Marketing",
        seo: "SEO",
        smm: "Social Media Marketing",
        management: "Management",
        "project-management": "Project Management",
        "accounting-finance": "Accounting & Finance",
        admin: "Admin",
        business: "Business",
        copywriting: "Copywriting",
        "e-commerce": "E-Commerce",
        education: "Education",
        healthcare: "Healthcare",
        hr: "HR",
        legal: "Legal",
        supporting: "Supporting",
        "translation-localization": "Translation & Localization",
        "video-audio-production": "Video & Audio Production",
      },
      default: ["dev"],
    },
  ],

  careerjet: [
    { key: "keywords", label: "Keywords", type: "text", hint: "Words AND'd. \"quotes\" for exact, -word to exclude. Defaults to your résumé keywords if left blank." },
    {
      key: "contract_type",
      label: "Contract type",
      type: "select",
      options: ["p", "c", "t", "i", "v"],
      optionLabels: { p: "Permanent", c: "Contract", t: "Temporary", i: "Internship / Training", v: "Voluntary" },
    },
    {
      key: "work_hours",
      label: "Work hours",
      type: "select",
      options: ["f", "p"],
      optionLabels: { f: "Full-time", p: "Part-time" },
    },
    {
      key: "sort",
      label: "Sort by",
      type: "select",
      options: ["date", "relevance", "salary"],
      optionLabels: { date: "Date", relevance: "Relevance", salary: "Salary" },
      default: "date",
    },
    { key: "radius", label: "Radius (km)", type: "number", hint: "Search radius in kilometres around the location." },
  ],

  // Sources whose engine fetchers take no configurable input — explicit empty entries
  // so filtersFor() returns [] instead of falling back to DEFAULT_FILTERS (query field).
  remoteok: [],
  arbeitnow: [],
  weworkremotely: [],
  himalayas: [],
  hackernews: [],
  freelancer: [],
  reddit: [],
  wuzzuf: [],
}

export const DEFAULT_FILTERS: FilterDef[] = [{ key: "query", label: "Search keywords", type: "text" }]

/**
 * Returns the filter definitions for a named source.
 * - Source with explicit empty array → [] (no configurable filters).
 * - Source present with definitions → those definitions.
 * - Unknown source (not in SOURCE_FILTERS) → DEFAULT_FILTERS (query fallback).
 */
export const filtersFor = (name: string): FilterDef[] => {
  if (name in SOURCE_FILTERS) return SOURCE_FILTERS[name]
  return DEFAULT_FILTERS
}
