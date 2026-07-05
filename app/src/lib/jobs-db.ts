import { Pool } from "pg"

const globalForJobs = globalThis as unknown as { jobsPool: Pool | undefined }

export const jobsDb =
  globalForJobs.jobsPool ??
  new Pool({
    host: process.env.JOBS_DB_HOST,
    port: parseInt(process.env.JOBS_DB_PORT || "5432", 10),
    database: process.env.JOBS_DB_NAME,
    user: process.env.JOBS_DB_USER,
    password: process.env.JOBS_DB_PASSWORD,
    max: 5,
  })

if (process.env.NODE_ENV !== "production") globalForJobs.jobsPool = jobsDb
