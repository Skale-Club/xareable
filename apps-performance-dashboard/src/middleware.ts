import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Access control (roadmap item 09 / Blocker B4): the dashboard exposes infra
 * internals, so it must be gated before serving real data.
 *
 * Stub: HTTP Basic auth via DASHBOARD_BASIC_AUTH ("user:password"). If unset,
 * the gate is OPEN (dev convenience) and a warning is emitted.
 *
 * B4 decision (production): front the app with Cloudflare Access (zero-trust,
 * no app-managed credentials) and leave DASHBOARD_BASIC_AUTH empty — or keep
 * Basic auth if a simple shared credential is acceptable. Decide before exposing
 * real infra data publicly.
 */

function unauthorized(): NextResponse {
  return new NextResponse("Authentication required.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="apps-performance-dashboard"' },
  });
}

export function middleware(req: NextRequest): NextResponse {
  const expected = process.env.DASHBOARD_BASIC_AUTH?.trim();

  if (!expected) {
    // Gate disabled — acceptable for local dev only.
    console.warn("[auth] DASHBOARD_BASIC_AUTH not set — dashboard is UNGATED (dev only). See Blocker B4.");
    return NextResponse.next();
  }

  const header = req.headers.get("authorization");
  if (!header || !header.startsWith("Basic ")) return unauthorized();

  try {
    if (atob(header.slice(6)) !== expected) return unauthorized();
  } catch {
    return unauthorized();
  }
  return NextResponse.next();
}

export const config = {
  // Gate everything except the open health check and Next internals/assets.
  matcher: ["/((?!api/health|_next/static|_next/image|favicon.ico).*)"],
};
