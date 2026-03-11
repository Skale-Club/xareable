import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createServer } from "http";
import { createApiRouter } from "../server/routes/index.js";
import { renderIndexHtml, shouldNoIndex } from "../server/index-template.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type Handler = (req: Request, res: Response) => unknown;

let appHandlerPromise: Promise<Handler> | null = null;

/**
 * Read the built _app.html template once and cache it.
 * On Vercel the static output lives at dist/public/ which is a sibling of
 * the serverless function bundle. We check a few likely locations.
 */
let cachedTemplate: string | null = null;

function getIndexTemplate(): string {
  if (cachedTemplate) return cachedTemplate;

  const candidates = [
    path.resolve(__dirname, "public", "_app.html"),
    path.resolve(__dirname, "..", "dist", "public", "_app.html"),
    path.resolve(__dirname, "..", "public", "_app.html"),
    path.resolve(process.cwd(), "dist", "public", "_app.html"),
  ];

  for (const candidate of candidates) {
    try {
      cachedTemplate = fs.readFileSync(candidate, "utf-8");
      return cachedTemplate;
    } catch {
      // try next
    }
  }

  throw new Error(
    `Could not find _app.html template. Tried: ${candidates.join(", ")}`,
  );
}

function normalizeApiUrl(req: Request) {
  const base = "http://localhost";
  const parsed = new URL(req.url || "/api", base);

  // SSR page rendering — rewrite URL to the requested page path
  const ssrPage = parsed.searchParams.get("ssrPage");
  if (ssrPage) {
    parsed.searchParams.delete("ssrPage");
    const pagePath = ssrPage.startsWith("/") ? ssrPage : `/${ssrPage}`;
    const search = parsed.searchParams.toString();
    req.url = search ? `${pagePath}?${search}` : pagePath;
    return;
  }

  const rawPath = parsed.searchParams.get("rawPath");
  if (rawPath) {
    parsed.searchParams.delete("rawPath");
    const search = parsed.searchParams.toString();
    req.url = search ? `/${rawPath}?${search}` : `/${rawPath}`;
    return;
  }

  const routePath = (parsed.searchParams.get("path") || "").replace(/^\/+/, "");

  parsed.searchParams.delete("path");

  const pathname = routePath ? `/api/${routePath}` : "/api";
  const search = parsed.searchParams.toString();

  req.url = search ? `${pathname}?${search}` : pathname;
}

async function createHandler(): Promise<Handler> {
  const app = express();
  const httpServer = createServer(app);

  app.use((req, _res, next) => {
    normalizeApiUrl(req as Request);
    next();
  });

  app.use(
    express.json({
      limit: "50mb",
      verify: (req, _res, buf) => {
        (req as Request & { rawBody?: unknown }).rawBody = buf;
      },
    }),
  );

  app.use(express.urlencoded({ extended: false }));

  // SSR route: serve _app.html with OG meta tags replaced
  app.get(
    ["/", "/privacy", "/terms"],
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const template = getIndexTemplate();
        const html = await renderIndexHtml(template, req);

        if (shouldNoIndex(req.path)) {
          res.setHeader("X-Robots-Tag", "noindex, nofollow");
        }

        res.status(200).set({ "Content-Type": "text/html" }).end(html);
      } catch (error) {
        console.error("SSR rendering error:", error);
        next(error);
      }
    },
  );

  // Use the modular router
  const apiRouter = createApiRouter();
  app.use(apiRouter);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      return next(err);
    }

    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    return res.status(status).json({ message });
  });

  return app as unknown as Handler;
}

export default async function handler(req: Request, res: Response) {
  try {
    if (!appHandlerPromise) {
      appHandlerPromise = createHandler().catch((error) => {
        appHandlerPromise = null;
        throw error;
      });
    }

    const appHandler = await appHandlerPromise;
    return appHandler(req, res);
  } catch (error: any) {
    console.error("API handler bootstrap failed:", error);
    return res.status(500).json({
      message: "API handler bootstrap failed",
      detail: error?.message || String(error),
    });
  }
}
