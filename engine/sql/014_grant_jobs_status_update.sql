-- 014_grant_jobs_status_update.sql
-- The finance status controls (single PATCH /api/jobs/[id] + bulk PATCH /api/jobs +
-- "dismiss matching") set jobs.status AND jobs.status_changed_at. jobsearch_app was only
-- granted UPDATE(status), so the write failed with "permission denied for table jobs" and
-- the UI reverted. Grant the column so status changes persist. Apply as `jobradar` (owner).

GRANT UPDATE (status, status_changed_at) ON jobs TO jobsearch_app;
