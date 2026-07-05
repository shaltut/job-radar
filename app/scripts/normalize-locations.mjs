#!/usr/bin/env node
// scripts/normalize-locations.mjs
//
// One-off location-standardization migration script. DRY RUN BY DEFAULT — it
// only writes to the database when invoked with --apply.
//
// Usage:
//   node scripts/normalize-locations.mjs                # dry run (default, no writes)
//   node scripts/normalize-locations.mjs --apply         # writes the changes
//   node scripts/normalize-locations.mjs --restore FILE  # roll back from a backup dump
//
// DB connection:
//   Reads the same JOBS_DB_HOST / JOBS_DB_PORT / JOBS_DB_NAME / JOBS_DB_USER /
//   JOBS_DB_PASSWORD env vars the app uses (see src/lib/jobs-db.ts). In this repo's
//   docker-compose.yml, JOBS_DB_HOST=postgres is a Docker network alias that only
//   resolves *inside* the jobradar_net compose network. This script is meant to be run
//   on the host (not in a container), so override the host when invoking it directly —
//   e.g. if you've published Postgres's port to the host:
//
//     JOBS_DB_HOST=127.0.0.1 node scripts/normalize-locations.mjs
//
//   (the postgres container publishes 5432 to 127.0.0.1, so this just works)
//
// Safety:
//   - Always dumps the full current `id, location` table to a timestamped
//     JSON backup file under scripts/backups/ before doing anything else —
//     including on a dry run — so there's always a rollback point.
//   - Only rows whose normalized value differs from the stored value are
//     touched; everything runs inside a single transaction that rolls back
//     on any error.
//   - `--restore FILE` replays a backup file's id/location pairs back onto
//     the table (also transactional) if a live run needs to be undone.

import { Pool } from "pg"
import { normalizeLocation } from "../src/lib/normalize-location.ts"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, "..")
const BACKUP_DIR = path.join(ROOT, "scripts", "backups")

// ---------------------------------------------------------------------------
// Env loading. Mirrors src/lib/jobs-db.ts's var names. Values already present
// in process.env always win, so `JOBS_DB_HOST=127.0.0.1 node scripts/...`
// cleanly overrides whatever .env.prod says.
// ---------------------------------------------------------------------------
function loadEnvFile(file) {
  if (!fs.existsSync(file)) return
  const text = fs.readFileSync(file, "utf8")
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eq = trimmed.indexOf("=")
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = value
  }
}
loadEnvFile(path.join(ROOT, ".env.prod"))
loadEnvFile(path.join(ROOT, ".env"))

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2)
const APPLY = args.includes("--apply")
const restoreIdx = args.indexOf("--restore")
const RESTORE_FILE = restoreIdx !== -1 ? args[restoreIdx + 1] : null

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-")
}

async function main() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true })

  const pool = new Pool({
    host: process.env.JOBS_DB_HOST,
    port: parseInt(process.env.JOBS_DB_PORT || "5432", 10),
    database: process.env.JOBS_DB_NAME,
    user: process.env.JOBS_DB_USER,
    password: process.env.JOBS_DB_PASSWORD,
    max: 2,
  })

  try {
    if (RESTORE_FILE) {
      await restore(pool, RESTORE_FILE)
    } else {
      await run(pool)
    }
  } catch (err) {
    if (err && (err.code === "ENOTFOUND" || err.code === "ECONNREFUSED")) {
      console.error(`\nCould not reach Postgres at ${process.env.JOBS_DB_HOST}:${process.env.JOBS_DB_PORT}.`)
      console.error("This script runs on the host, not inside the docker network, so JOBS_DB_HOST=postgres")
      console.error("(the value loaded from .env.prod) will not resolve here. Try:\n")
      console.error("  JOBS_DB_HOST=127.0.0.1 node scripts/normalize-locations.mjs\n")
    }
    throw err
  } finally {
    await pool.end()
  }
}

async function run(pool) {
  const { rows } = await pool.query("SELECT id, location FROM jobs ORDER BY id")

  const backupFile = path.join(BACKUP_DIR, `jobs-locations-${timestamp()}.json`)
  fs.writeFileSync(backupFile, JSON.stringify(rows, null, 2))
  console.log(`Backup written: ${backupFile} (${rows.length} rows)`)

  const beforeDistinct = new Set(rows.map((r) => r.location ?? "∅")).size

  const changes = []
  const afterValues = []
  for (const row of rows) {
    const next = normalizeLocation(row.location)
    afterValues.push(next ?? "∅")
    if (next !== row.location) changes.push({ id: row.id, from: row.location, to: next })
  }
  const afterDistinct = new Set(afterValues).size

  console.log(`\nRows scanned: ${rows.length}`)
  console.log(`Distinct locations: ${beforeDistinct} -> ${afterDistinct}`)
  console.log(`Rows that would change: ${changes.length}`)

  console.log("\nSample of changes (first 20 of " + changes.length + "):")
  for (const c of changes.slice(0, 20)) {
    console.log(`  #${c.id}: ${JSON.stringify(c.from)} -> ${JSON.stringify(c.to)}`)
  }

  if (!APPLY) {
    console.log("\nDRY RUN — no rows were changed. Re-run with --apply to write these changes.")
    return
  }

  console.log(`\nApplying ${changes.length} updates inside a transaction...`)
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    for (const c of changes) {
      // race guard: only write if location is STILL the pre-normalized value — never clobber a
      // concurrent engine write (the discovery timers write jobs.location while this runs).
      await client.query("UPDATE jobs SET location = $1 WHERE id = $2 AND location IS NOT DISTINCT FROM $3", [c.to, c.id, c.from])
    }
    await client.query("COMMIT")
    console.log(`Applied. ${changes.length} rows updated.`)
    console.log(`Rollback source if needed: node scripts/normalize-locations.mjs --restore ${path.relative(ROOT, backupFile)}`)
  } catch (err) {
    await client.query("ROLLBACK")
    console.error("Update failed — rolled back. No changes were made.")
    throw err
  } finally {
    client.release()
  }
}

async function restore(pool, backupFile) {
  const abs = path.isAbsolute(backupFile) ? backupFile : path.join(ROOT, backupFile)
  const rows = JSON.parse(fs.readFileSync(abs, "utf8"))
  console.log(`Restoring ${rows.length} rows from ${abs}...`)
  // safety: snapshot CURRENT values before overwriting, so a wrong restore is itself reversible.
  const cur = (await pool.query("SELECT id, location FROM jobs WHERE id = ANY($1)", [rows.map((r) => r.id)])).rows
  fs.mkdirSync(BACKUP_DIR, { recursive: true })
  const preRestoreFile = path.join(BACKUP_DIR, `jobs-locations-prerestore-${timestamp()}.json`)
  fs.writeFileSync(preRestoreFile, JSON.stringify(cur, null, 2))
  console.log(`Pre-restore backup: ${path.relative(ROOT, preRestoreFile)}`)
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    for (const row of rows) {
      await client.query("UPDATE jobs SET location = $1 WHERE id = $2", [row.location, row.id])
    }
    await client.query("COMMIT")
    console.log(`Restored ${rows.length} rows.`)
  } catch (err) {
    await client.query("ROLLBACK")
    console.error("Restore failed — rolled back.")
    throw err
  } finally {
    client.release()
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
