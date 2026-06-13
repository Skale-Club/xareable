import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import { createApiRouter } from "./routes/index.js";
import { serveStatic } from "./static.js";
import { createServer } from "http";
import { logConfigStatus } from "./config/index.js";
import { startCronJobs } from "./services/cleanup-cron.service.js";
import { captureException, installProcessSafetyNets } from "./lib/observability.js";

const app = express();
const httpServer = createServer(app);

logConfigStatus();
installProcessSafetyNets();

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    limit: "50mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

(async () => {
  // Request logging middleware. Logs method/path/status/duration only —
  // deliberately NOT the response body (it can carry user data, captions,
  // signed URLs, tokens) which must never land in plaintext logs.
  app.use((req, res, next) => {
    const start = Date.now();
    const path = req.path;

    res.on("finish", () => {
      const duration = Date.now() - start;
      if (path.startsWith("/api")) {
        log(`${req.method} ${path} ${res.statusCode} in ${duration}ms`);
      }
    });

    next();
  });

  // Use the modular router
  const apiRouter = createApiRouter();
  app.use(apiRouter);

  // Error handler
  app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    captureException(err, { source: "express", method: req.method, path: req.path });
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite.js");
    await setupVite(httpServer, app);
  }

  // Start server
  const port = parseInt(process.env.PORT || "8888", 10);
  httpServer.listen(port, "0.0.0.0", () => {
    log(`serving on port ${port}`);
    startCronJobs().catch((err) =>
      captureException(err, { source: "startCronJobs" }),
    );
  });
})();

export default httpServer;
