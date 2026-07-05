import type { Queryable } from "./jobs-repo"

export interface Funnel { inbox: number; shortlisted: number; applied: number; interviewing: number; offer: number; rejected: number; dismissed: number; total: number }
export interface SourceStat { source: string; total: number; shortlisted_plus: number; applied_plus: number }
export interface DayCount { day: string; count: number }
export interface ScoreDist { excellent: number; strong: number; fair: number; weak: number; unscored: number }
export interface StageStat { status: string; n: number; avg_days: number; max_days: number }
export interface StaleJob { id: number; title: string; company: string | null; status: string; url: string; days: number }

/** Count of jobs CURRENTLY at each lifecycle stage (snapshot, not cumulative). */
export async function getFunnel(client: Queryable, tenantId: string): Promise<Funnel> {
  const res = await client.query(`
    SELECT
      count(*) FILTER (WHERE status IN ('new','notified'))::int AS inbox,
      count(*) FILTER (WHERE status = 'shortlisted')::int        AS shortlisted,
      count(*) FILTER (WHERE status = 'applied')::int            AS applied,
      count(*) FILTER (WHERE status = 'interviewing')::int       AS interviewing,
      count(*) FILTER (WHERE status = 'offer')::int              AS offer,
      count(*) FILTER (WHERE status = 'rejected')::int           AS rejected,
      count(*) FILTER (WHERE status = 'dismissed')::int          AS dismissed,
      count(*)::int                                              AS total
    FROM jobs WHERE tenant_id = $1`, [tenantId])
  return res.rows[0] as Funnel
}

/** Per source: total + how many reached shortlist / applied (rejected counted as having applied). */
export async function getSourceEffectiveness(client: Queryable, tenantId: string): Promise<SourceStat[]> {
  const res = await client.query(`
    SELECT source,
      count(*)::int AS total,
      count(*) FILTER (WHERE status IN ('shortlisted','applied','interviewing','offer','rejected'))::int AS shortlisted_plus,
      count(*) FILTER (WHERE status IN ('applied','interviewing','offer','rejected'))::int               AS applied_plus
    FROM jobs
    WHERE tenant_id = $1
    GROUP BY source
    ORDER BY total DESC, source ASC`, [tenantId])
  return res.rows as SourceStat[]
}

/** Jobs added per day over the last `days` days (zero-days absent). */
export async function getDailyVolume(client: Queryable, tenantId: string, { days = 30 }: { days?: number } = {}): Promise<DayCount[]> {
  const res = await client.query(`
    SELECT to_char(date_trunc('day', discovered_at), 'YYYY-MM-DD') AS day, count(*)::int AS count
    FROM jobs
    WHERE tenant_id = $1 AND discovered_at >= now() - ($2 || ' days')::interval
    GROUP BY day ORDER BY day`, [tenantId, String(days)])
  return res.rows as DayCount[]
}

/** Score-tier counts (85/70/55 thresholds) + unscored. */
export async function getScoreDistribution(client: Queryable, tenantId: string): Promise<ScoreDist> {
  const res = await client.query(`
    SELECT
      count(*) FILTER (WHERE score >= 85)::int                      AS excellent,
      count(*) FILTER (WHERE score >= 70 AND score < 85)::int       AS strong,
      count(*) FILTER (WHERE score >= 55 AND score < 70)::int       AS fair,
      count(*) FILTER (WHERE score IS NOT NULL AND score < 55)::int AS weak,
      count(*) FILTER (WHERE score IS NULL)::int                    AS unscored
    FROM jobs WHERE tenant_id = $1`, [tenantId])
  return res.rows[0] as ScoreDist
}

/** For applied/interviewing: per-status summary + the 5 stalest jobs. */
export async function getTimeInStage(client: Queryable, tenantId: string): Promise<{ summary: StageStat[]; stalest: StaleJob[] }> {
  const summaryRes = await client.query(`
    SELECT status, count(*)::int AS n,
      round(avg(extract(epoch FROM now() - status_changed_at) / 86400))::int AS avg_days,
      round(max(extract(epoch FROM now() - status_changed_at) / 86400))::int AS max_days
    FROM jobs WHERE tenant_id = $1 AND status IN ('applied','interviewing')
    GROUP BY status`, [tenantId])
  const stalestRes = await client.query(`
    SELECT id, title, company, status, url,
      floor(extract(epoch FROM now() - status_changed_at) / 86400)::int AS days
    FROM jobs WHERE tenant_id = $1 AND status IN ('applied','interviewing')
    ORDER BY status_changed_at ASC LIMIT 5`, [tenantId])
  return { summary: summaryRes.rows as StageStat[], stalest: stalestRes.rows as StaleJob[] }
}
