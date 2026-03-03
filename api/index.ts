import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "../server/routes";
import { serveStatic } from "../server/static";

const app = express();

app.use(
  express.json({
    limit: "50mb",
    verify: (req: any, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

// Initialize routes (only once)
let initialized = false;
async function initialize() {
  if (!initialized) {
    await registerRoutes(null as any, app);

    app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
      const status = err.status || err.statusCode || 500;
      const message = err.message || "Internal Server Error";
      console.error("Internal Server Error:", err);
      if (res.headersSent) {
        return next(err);
      }
      return res.status(status).json({ message });
    });

    serveStatic(app);
    initialized = true;
  }
}

export default async function handler(req: any, res: any) {
  await initialize();
  return app(req, res);
}
