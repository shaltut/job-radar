/** Fetch current-month Apify usage vs the plan limit. */
export async function apifyMonthlyUsage(token, { fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`https://api.apify.com/v2/users/me/limits?token=${token}`, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`apify limits HTTP ${res.status}`);
  const d = (await res.json()).data || {};
  const monthlyUsd = d.current?.monthlyUsageUsd ?? 0;
  const limitUsd = d.limits?.maxMonthlyUsageUsd ?? null;
  const pct = limitUsd ? Math.round((monthlyUsd / limitUsd) * 100) : null;
  return { monthlyUsd, limitUsd, pct };
}

/** Telegram-alert once per month when monthly spend ≥ pct% of the limit. Best-effort; returns {alerted, pct}. */
export async function checkApifySpend(client, { token, pct = 80, fetchImpl = fetch, notify } = {}) {
  if (!token) return { alerted: false, pct: null };
  const u = await apifyMonthlyUsage(token, { fetchImpl });
  if (u.pct == null || u.pct < pct) return { alerted: false, pct: u.pct };
  const month = new Date().toISOString().slice(0, 7); // YYYY-MM
  const ins = await client.query(
    `INSERT INTO apify_alerts (month, pct) VALUES ($1, $2) ON CONFLICT (month) DO NOTHING`,
    [month, u.pct],
  );
  if (!ins.rowCount) return { alerted: false, pct: u.pct }; // already alerted this month
  if (notify) await notify(`⚠️ Apify spend at <b>${u.pct}%</b> of the monthly limit ($${u.monthlyUsd.toFixed(2)} / $${u.limitUsd}).`);
  return { alerted: true, pct: u.pct };
}
