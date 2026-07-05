import { NextResponse } from "next/server"
import { jobsDb } from "@/lib/jobs-db"
import { requireTenant } from "@/lib/tenancy"
import { getFunnel, getSourceEffectiveness, getDailyVolume, getScoreDistribution, getTimeInStage } from "@/lib/insights-repo"

export async function GET() {
  try {
    const { tenantId } = await requireTenant()
    const [funnel, sources, volume, scores, timeInStage] = await Promise.all([
      getFunnel(jobsDb, tenantId),
      getSourceEffectiveness(jobsDb, tenantId),
      getDailyVolume(jobsDb, tenantId),
      getScoreDistribution(jobsDb, tenantId),
      getTimeInStage(jobsDb, tenantId),
    ])
    return NextResponse.json({ funnel, sources, volume, scores, timeInStage })
  } catch (error) {
    console.error("[/api/jobs/insights GET]", error)
    return NextResponse.json({ error: "Failed to compute insights" }, { status: 500 })
  }
}
