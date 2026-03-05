import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { createServer } from "http";
import { registerRoutes } from "../server/routes";

type Handler = (req: Request, res: Response) => unknown;

let appHandlerPromise: Promise<Handler> | null = null;

async function createHandler(): Promise<Handler> {
  const app = express();
  const httpServer = createServer(app);

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
  if (!appHandlerPromise) {
    appHandlerPromise = createHandler().catch((error) => {
      appHandlerPromise = null;
      throw error;
    });
  }

  const appHandler = await appHandlerPromise;
  return appHandler(req, res);
}

