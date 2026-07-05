// No-op global setup for jobs-app unit tests.
//
// vitest.config.ts (copied verbatim from /opt/financial-app in Task 1) references
// tests/helpers/global-setup.ts as its globalSetup file. Finance's version runs a
// DB cleanup against the `financial` Postgres database (expenses/loans/goals/etc.
// tables) via `sudo docker exec postgres psql ... -d financial`. None of that
// applies here: jobs-app's lib tests (jobs-repo, jobs-url, jobs-chips, salary-chip,
// apify-api, job-summary, relative-time, insights, insights-repo, discovery-repo,
// jobs-materials, multi-select) all use fake/mocked pg clients, not a real DB
// connection, so there is nothing to clean up.
//
// Without SOME file here, vitest fails to start at all (globalSetup module not
// found), so this stub exists purely to satisfy that config requirement. If a
// later task (Task 5, moving routes) adds integration-style tests that hit a real
// jobs DB, replace this with real setup/teardown against JOBS_DB_* at that point.
export async function setup() {}
export async function teardown() {}
