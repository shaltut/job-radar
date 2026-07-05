import { NextRequest, NextResponse } from "next/server"
import { jobsDb } from "@/lib/jobs-db"
import { requireTenant } from "@/lib/tenancy"
import { isValidStatus, updateJobStatus, getJob } from "@/lib/jobs-repo"

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { tenantId } = await requireTenant()
    const { id: idRaw } = await params
    const id = parseInt(idRaw, 10)
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "Invalid job id" }, { status: 400 })
    }
    const job = await getJob(jobsDb, tenantId, id)
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 })
    return NextResponse.json({ job })
  } catch (error) {
    console.error("[/api/jobs/:id GET]", error)
    return NextResponse.json({ error: "Failed to fetch job" }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { tenantId } = await requireTenant()
    const { id: idRaw } = await params
    const id = parseInt(idRaw, 10)
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "Invalid job id" }, { status: 400 })
    }
    const body = await request.json().catch(() => ({}))
    const status = (body as { status?: unknown }).status
    if (!isValidStatus(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 })
    }
    const row = await updateJobStatus(jobsDb, tenantId, id, status)
    if (!row) return NextResponse.json({ error: "Job not found" }, { status: 404 })
    return NextResponse.json(row)
  } catch (error) {
    console.error("[/api/jobs/:id PATCH]", error)
    return NextResponse.json({ error: "Failed to update job" }, { status: 500 })
  }
}
