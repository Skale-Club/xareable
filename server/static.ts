import express, { type Express } from "express";
import fs from "fs";
import path from "path";

const NOINDEX_PATH_PREFIXES = [
  "/admin",
  "/billing",
  "/dashboard",
  "/login",
  "/onboarding",
  "/posts",
  "/settings",
];

function shouldNoIndex(pathname: string) {
  return NOINDEX_PATH_PREFIXES.some((prefix) =>
    pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  app.use(express.static(distPath));

  // fall through to index.html if the file doesn't exist
  app.use("/{*path}", (req, res) => {
    if (shouldNoIndex(req.path)) {
      res.setHeader("X-Robots-Tag", "noindex, nofollow");
    }

    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
