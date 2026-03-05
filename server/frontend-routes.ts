const EXACT_CLIENT_ROUTES = new Set([
  "/",
  "/index.html",
  "/privacy",
  "/terms",
  "/login",
  "/dashboard",
  "/posts",
  "/settings",
  "/admin",
  "/affiliate",
  "/credits",
  "/onboarding",
]);

export function isKnownClientRoute(pathname: string) {
  if (EXACT_CLIENT_ROUTES.has(pathname)) {
    return true;
  }

  // Matches /admin/:tab from AppRouter.
  return /^\/admin\/[^/]+$/.test(pathname);
}

