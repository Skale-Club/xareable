import { NextResponse } from "next/server";

// Ungated (see middleware matcher) so the container HEALTHCHECK can reach it.
export const dynamic = "force-dynamic";

export function GET(): NextResponse {
  return NextResponse.json({
    ok: true,
    service: "apps-performance-dashboard",
    time: new Date().toISOString(),
  });
}
