import { getJobsToNotify, markNotified, getFollowUps } from './db.js';
import { formatDigest, formatFollowups, formatHealthFooter, formatJobCard, jobButtons, DIGEST_MAX } from './digest.js';
import { getRecentSourceRuns, summarizeSourceHealth } from './sourceRuns.js';
import { sendTelegram } from './telegram.js';

/** Pull new jobs + due follow-ups + source health. Send the top `cardLimit` new jobs as
 *  individual actionable (button) messages; the rest + follow-ups + health footer as one
 *  summary message. Marks ONLY the jobs actually shown AND successfully sent. */
export async function runDigest({
  client, hours = 24, threshold = 70, appliedDays = 7, interviewingDays = 5,
  token, chatId, fetchImpl = fetch,
  staleHours = 48, dryRuns = 3, nowMs = Date.now(), cardLimit = 5,
  getRecent = getRecentSourceRuns, summarize = summarizeSourceHealth,
  _getJobs = getJobsToNotify, _getFollowUps = getFollowUps, _markNotified = markNotified,
}) {
  const jobs = await _getJobs(client, hours, threshold);
  const followups = await _getFollowUps(client, { appliedDays, interviewingDays });

  let summary = [];
  try { summary = summarize(await getRecent(client), { staleHours, nowMs }); }
  catch (e) { console.error('[digest] source health unavailable:', e.message); }
  const warn = summary.some((s) => !s.stale && (s.consecutiveErrors > 0 || s.consecutiveDry >= dryRuns));

  if (jobs.length === 0 && followups.length === 0 && !warn) return { sent: 0, followups: 0, warned: false };

  // Track only what we actually deliver, so a job is never flipped to 'notified' unless the user saw it.
  const notifyIds = [];

  // Top N new jobs → individual actionable (button) messages (best-effort per card).
  for (const j of jobs.slice(0, cardLimit)) {
    try {
      await sendTelegram(formatJobCard(j), { token, chatId, fetchImpl, replyMarkup: jobButtons(j.id) });
      notifyIds.push(j.id);
    } catch (e) {
      console.error('[digest] card send failed:', e.message);
    }
  }

  // Summary: remaining new jobs (capped at DIGEST_MAX in the render) + follow-ups + health footer.
  const rest = jobs.slice(cardLimit);
  const shownRest = rest.slice(0, DIGEST_MAX); // formatDigest only renders the first DIGEST_MAX
  const parts = [];
  if (rest.length) parts.push(formatDigest(rest));
  if (followups.length) parts.push(formatFollowups(followups));
  if (summary.length) parts.push(formatHealthFooter(summary, { dryRuns, nowMs }));
  if (parts.length) {
    try {
      await sendTelegram(parts.join('\n\n'), { token, chatId, fetchImpl });
      for (const j of shownRest) notifyIds.push(j.id); // mark the overflow only if the summary actually sent
    } catch (e) {
      console.error('[digest] summary send failed:', e.message);
    }
  }

  if (notifyIds.length) await _markNotified(client, notifyIds);
  return { sent: notifyIds.length, followups: followups.length, warned: warn };
}
