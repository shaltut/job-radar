import { getJobsToScore, setScore, setScoreError } from './db.js';
import { scoreJob } from './openai.js';

/** Score unscored/all/backfill jobs against the profile; write the full result. DI for testing. */
export async function runScore({
  client, profileText, all = false, backfill = false, threshold = 70, openai = {},
  getJobs = getJobsToScore, score = scoreJob, write = setScore, fail = setScoreError,
}) {
  const jobs = await getJobs(client, { all, backfill, threshold });
  let scored = 0;
  let failed = 0;
  for (const job of jobs) {
    const result = await score(job, profileText, openai);
    if (result) {
      await write(client, job.id, result);
      scored++;
    } else {
      await fail(client, job.id);
      failed++;
    }
  }
  return { scored, failed };
}
