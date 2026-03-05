import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { createServer } from "http";

type Handler = (req: Request, res: Response) => unknown;

let appHandlerPromise: Promise<Handler> | null = null;

function normalizeApiUrl(req: Request) {
  const base = "http://localhost";
  const parsed = new URL(req.url || "/api", base);
  const routePath = (parsed.searchParams.get("path") || "").replace(/^\/+/, "");

  parsed.searchParams.delete("path");

  const pathname = routePath ? `/api/${routePath}` : "/api";
  const search = parsed.searchParams.toString();

  req.url = search ? `${pathname}?${search}` : pathname;
}

async function createHandler(): Promise<Handler> {
  const app = express();
  const httpServer = createServer(app);
  const { registerRoutes } = await import("../server/routes");

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

  await registerRoutes(httpServer, app);

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
