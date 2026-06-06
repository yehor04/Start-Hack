import { NextResponse } from "next/server";
import { getTodaySchedule, getActiveRecovery, getKpis } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET() {
  const [schedule, recovery, kpis] = await Promise.all([
    getTodaySchedule(),
    getActiveRecovery(),
    getKpis(),
  ]);
  return NextResponse.json({ schedule, recovery, kpis });
}
