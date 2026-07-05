import { NextRequest, NextResponse } from "next/server"
import { jobsDb } from "@/lib/jobs-db"
import { requireTenant } from "@/lib/tenancy"
import { getSkillsGap } from "@/lib/jobs-repo"

export async function GET(request: NextRequest) {
  try {
    const { tenantId } = await requireTenant()
    const raw = parseInt(request.nextUrl.searchParams.get("threshold") || "", 10)
    const threshold = Number.isFinite(raw) && raw >= 0 && raw <= 100 ? raw : 70
    const { skills, jobCount } = await getSkillsGap(jobsDb, tenantId, { threshold })
    return NextResponse.json({ skills, jobCount, threshold })
  } catch (error) {
    console.error("[/api/jobs/skills-gap GET]", error)
    return NextResponse.json({ error: "Failed to compute skills gap" }, { status: 500 })
  }
}
