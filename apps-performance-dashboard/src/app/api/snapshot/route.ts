import { NextResponse } from "next/server";
import { getSnapshot } from "@/lib/collector";

// Serves the normalized snapshot to the client. Gated by middleware (it carries
// infra data). `?force=1` bypasses the short server-side cache (manual refresh).
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request): Promise<NextResponse> {
  const force = new URL(request.url).searchParams.get("force") === "1";
  const snapshot = await getSnapshot(force);
  return NextResponse.json(snapshot, { headers: { "cache-control": "no-store" } });
}
