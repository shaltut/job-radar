import { NextRequest, NextResponse } from "next/server"
import { readFile } from "node:fs/promises"
import { jobsDb } from "@/lib/jobs-db"
import { requireTenant } from "@/lib/tenancy"
import { getJobCompany } from "@/lib/jobs-repo"
import { resolveMaterialPath } from "@/lib/jobs-materials"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// kind → column. Allow-list: the column name is never taken from user input directly.
const KINDS = { cv: "cv_pdf", cover: "cover_pdf" } as const

// Sanitize into a filename-safe token: keep [A-Za-z0-9], collapse other runs to a
// single '-', trim leading/trailing '-'. Falls back to the given default when empty.
function sanitizeToken(value: string, fallback: string): string {
  const token = value.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
  return token || fallback
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string; kind: string }> }) {
  try {
    const { tenantId } = await requireTenant()
    const { id: idRaw, kind } = await params
    const id = parseInt(idRaw, 10)
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Invalid job id" }, { status: 400 })
    const col = KINDS[kind as keyof typeof KINDS]
    if (!col) return NextResponse.json({ error: "Invalid kind" }, { status: 400 })

    const res = await jobsDb.query(`SELECT ${col} AS name FROM jobs WHERE id = $1 AND tenant_id = $2`, [id, tenantId])
    if (res.rows.length === 0) return NextResponse.json({ error: "Job not found" }, { status: 404 })
    const name = res.rows[0].name as string | null | undefined
    const baseDir = process.env.JOBS_MATERIALS_DIR || "/app/job-materials"
    const filePath = resolveMaterialPath(baseDir, name)
    if (!filePath) return NextResponse.json({ error: "No material available" }, { status: 404 })

    let buf: Buffer
    try { buf = await readFile(filePath) } catch { return NextResponse.json({ error: "Not found" }, { status: 404 }) }

    // Build a friendly download name: [ApplicantName]-[YYYY-MM-DD]-[Company]-[CV|Cover].pdf
    const applicant = sanitizeToken(process.env.APPLICANT_NAME || "Ahmed", "Ahmed")
    const company = sanitizeToken(await getJobCompany(jobsDb, tenantId, id) || "", "Company")
    const date = new Date().toISOString().slice(0, 10) // YYYY-MM-DD (server today)
    const kindLabel = kind === "cv" ? "CV" : "Cover"
    const downloadName = `${applicant}-${date}-${company}-${kindLabel}.pdf`

    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${downloadName}"`,
        "Cache-Control": "private, max-age=60",
      },
    })
  } catch (error) {
    console.error("[/api/jobs/:id/materials/:kind]", error)
    return NextResponse.json({ error: "Failed to load materials" }, { status: 500 })
  }
}
