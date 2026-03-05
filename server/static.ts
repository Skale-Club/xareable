import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import { renderIndexHtml, shouldNoIndex } from "./index-template.js";
import { isKnownClientRoute } from "./frontend-routes.js";

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  const clientTemplate = fs.readFileSync(path.resolve(distPath, "index.html"), "utf-8");

  app.get("/{*path}", async (req, res, next) => {
    if (req.path.startsWith("/api/")) {
      return next();
    }

    if (req.path !== "/" && req.path !== "/index.html" && path.extname(req.path)) {
      return next();
    }

    if (!isKnownClientRoute(req.path)) {
      return res.redirect(302, "/");
    }

    if (shouldNoIndex(req.path)) {
      res.setHeader("X-Robots-Tag", "noindex, nofollow");
    }

    const html = await renderIndexHtml(clientTemplate, req);
    res.status(200).set({ "Content-Type": "text/html" }).end(html);
  });

  app.use(express.static(distPath, { index: false }));
}
