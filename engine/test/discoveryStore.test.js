import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadDiscoveryConfig, seedSourcesSql } from '../src/discoveryStore.js';

const TENANT = 4;

// Fake pg client routing by the table named in the SQL.
function fakeClient(tables) {
  return {
    async query(text) {
      if (/FROM sources/i.test(text)) return { rows: tables.sources ?? [] };
      if (/FROM discovery_excludes/i.test(text)) return { rows: tables.excludes ?? [] };
      return { rows: [] };
    },
  };
}

test('loadDiscoveryConfig scopes the sources read to tenant_source_config by tenantId', async () => {
  const calls = [];
  const client = { async query(text, params) {
    calls.push({ text, params });
    if (/FROM sources/i.test(text)) return { rows: [{ name: 'remotive', enabled: true, config: {}, run_interval_hours: 12, last_run_at: null }] };
    if (/FROM discovery_excludes/i.test(text)) return { rows: [] };
    return { rows: [] };
  }};
  await loadDiscoveryConfig(client, 4);
  const sourcesCall = calls.find((c) => /FROM sources/i.test(c.text));
  assert.match(sourcesCall.text, /LEFT JOIN tenant_source_config tsc ON tsc\.source_name = s\.name AND tsc\.tenant_id = \$1/);
  assert.deepEqual(sourcesCall.params, [4]);
  const excludesCall = calls.find((c) => /FROM discovery_excludes/i.test(c.text));
  assert.match(excludesCall.text, /WHERE tenant_id = \$1/);
  assert.deepEqual(excludesCall.params, [4]);
});

test('loadDiscoveryConfig without a tenantId falls back to {sources:null,excludes:null} (P2, never throws)', async () => {
  const client = { async query() { throw new Error('should not be called'); } };
  const cfg = await loadDiscoveryConfig(client, undefined);
  assert.deepEqual(cfg, { sources: null, excludes: null });
});

test('loadDiscoveryConfig maps rows into sources Map + excludes array (no countries)', async () => {
  const client = fakeClient({
    sources: [{ name: 'remotive', enabled: true }, { name: 'bayt', enabled: false }],
    excludes: [{ term: 'junior' }, { term: 'ios developer' }],
  });
  const cfg = await loadDiscoveryConfig(client, TENANT);
  assert.ok(cfg.sources instanceof Map);
  assert.equal(cfg.sources.get('remotive'), true);
  assert.equal(cfg.sources.get('bayt'), false);
  assert.equal(cfg.countries, undefined, 'countries field is no longer returned');
  assert.deepEqual(cfg.excludes, ['junior', 'ios developer']);
});

test('loadDiscoveryConfig returns empty (non-null) sources + excludes when tables are present but empty', async () => {
  const cfg = await loadDiscoveryConfig(fakeClient({ sources: [], excludes: [] }), TENANT);
  assert.ok(cfg.sources instanceof Map);
  assert.equal(cfg.sources.size, 0);
  assert.equal(cfg.countries, undefined, 'countries field is no longer returned');
  assert.deepEqual(cfg.excludes, []);
});

test('loadDiscoveryConfig: table-missing (Postgres 42P01) → {null,null} and does NOT throw (P2)', async () => {
  const client = {
    async query() {
      const e = new Error('relation "sources" does not exist');
      e.code = '42P01';
      throw e;
    },
  };
  const cfg = await loadDiscoveryConfig(client, TENANT);
  assert.deepEqual(cfg, { sources: null, excludes: null });
});

test('loadDiscoveryConfig: connection error → {null,null} (P2)', async () => {
  const client = { async query() { throw new Error('ECONNREFUSED'); } };
  const cfg = await loadDiscoveryConfig(client, TENANT);
  assert.deepEqual(cfg, { sources: null, excludes: null });
});

test('loadDiscoveryConfig surfaces each source row config into cfg.sourceConfigs', async () => {
  const upworkConfig = { experienceLevel: ['expert'], jobType: ['hourly'], advanced: { paymentVerified: true } };
  const client = fakeClient({
    sources: [
      { name: 'upwork', enabled: true, config: upworkConfig },
      { name: 'remotive', enabled: true, config: null },
      { name: 'bayt', enabled: false, config: {} },
    ],
    countries: [],
    excludes: [],
  });
  const cfg = await loadDiscoveryConfig(client, TENANT);
  assert.deepEqual(cfg.sourceConfigs.upwork, upworkConfig);
  assert.deepEqual(cfg.sourceConfigs.remotive, {});    // null config → {}
  assert.deepEqual(cfg.sourceConfigs.bayt, {});        // empty object stays {}
});

test('loadDiscoveryConfig sourceConfigs is {} when sources table is empty', async () => {
  const cfg = await loadDiscoveryConfig(fakeClient({ sources: [], countries: [], excludes: [] }), TENANT);
  assert.deepEqual(cfg.sourceConfigs, {});
});

test('loadDiscoveryConfig error path does not surface sourceConfigs (backward compat: returns null fields)', async () => {
  const client = { async query() { throw new Error('ECONNREFUSED'); } };
  const cfg = await loadDiscoveryConfig(client, TENANT);
  assert.equal(cfg.sourceConfigs, undefined);   // error path: legacy null fields only
});

test('seedSourcesSql emits one row per family, enabled=enable_by_default, ON CONFLICT DO NOTHING', () => {
  const families = [
    { name: 'remotive', market: 'global', enableByDefault: true },
    { name: 'jobicy', market: 'global', enableByDefault: true },
    { name: 'bayt', market: 'mena', enableByDefault: false },
    { name: 'naukrigulf', market: 'mena', enableByDefault: false },
    { name: 'linkedin', market: 'global', enableByDefault: false },
  ];
  const sql = seedSourcesSql(families);
  assert.match(sql, /INSERT INTO sources \(name, market, enabled, enable_by_default\) VALUES/);
  assert.match(sql, /ON CONFLICT \(name\) DO NOTHING/);
  // free sources seed ON
  assert.match(sql, /\('remotive','global', *true, *true\)/);
  assert.match(sql, /\('jobicy','global', *true, *true\)/);
  // paid families seed OFF (P3)
  assert.match(sql, /\('bayt','mena', *false, *false\)/);
  assert.match(sql, /\('naukrigulf','mena', *false, *false\)/);
  assert.match(sql, /\('linkedin','global', *false, *false\)/);
  // one VALUES row per family
  assert.equal((sql.match(/\(\s*'[a-z]+'\s*,/g) || []).length, families.length);
});

test('seedSourcesSql is safe when given an empty family list', () => {
  const sql = seedSourcesSql([]);
  // no rows → no INSERT statement (or a harmless no-op), but must be a string
  assert.equal(typeof sql, 'string');
});
