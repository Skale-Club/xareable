/**
 * Lightweight, vendor-agnostic observability layer.
 *
 * Goal: make failures VISIBLE — structured, greppable JSON log lines that a log
 * drain (Coolify, Datadog, CloudWatch…) can parse — and provide a single
 * capture seam that an external error tracker (Sentry, etc.) can be wired into
 * later WITHOUT touching call sites. No external dependency is pulled in here.
 */

type LogLevel = "info" | "warn" | "error";

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function emit(level: LogLevel, message: string, context?: Record<string, unknown>): void {
  const line = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...(context ? { ctx: context } : {}),
  };
  const serialized = safeStringify(line);
  if (level === "error") console.error(serialized);
  else if (level === "warn") console.warn(serialized);
  else console.log(serialized);
}

export const logger = {
  info: (msg: string, ctx?: Record<string, unknown>) => emit("info", msg, ctx),
  warn: (msg: string, ctx?: Record<string, unknown>) => emit("warn", msg, ctx),
  error: (msg: string, ctx?: Record<string, unknown>) => emit("error", msg, ctx),
};

function serializeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack };
  }
  return { message: String(err) };
}

let exceptionForwarder:
  | ((err: unknown, ctx?: Record<string, unknown>) => void)
  | null = null;

/**
 * Wire an external error tracker (e.g. Sentry) without touching call sites.
 * Call once during bootstrap after initialising the tracker:
 *
 *   import * as Sentry from "@sentry/node";
 *   Sentry.init({ dsn: process.env.SENTRY_DSN });
 *   setExceptionForwarder((err, ctx) => Sentry.captureException(err, { extra: ctx }));
 */
export function setExceptionForwarder(
  fn: (err: unknown, ctx?: Record<string, unknown>) => void,
): void {
  exceptionForwarder = fn;
}

/**
 * Central error-capture seam. Logs a structured error line and forwards to an
 * external tracker when one is wired up. Safe to call from anywhere (cron jobs,
 * route handlers, process-level handlers) — it never throws.
 */
export function captureException(err: unknown, context?: Record<string, unknown>): void {
  try {
    emit("error", "exception", { ...context, error: serializeError(err) });
    if (exceptionForwarder) {
      exceptionForwarder(err, context);
    }
  } catch {
    // Never let the error reporter itself crash the caller.
  }
}

let installed = false;

/**
 * Install process-level safety nets so a stray rejection or uncaught error is
 * captured (structured + visible) instead of vanishing.
 *
 * - uncaughtException: the process state is undefined afterwards, so we capture
 *   then exit(1) — preserving the default crash-and-restart contract (Coolify
 *   `restart: unless-stopped` brings the container back).
 * - unhandledRejection: captured but NON-fatal. A single orphan rejection in
 *   one request should not take the whole server down for every user. The
 *   structured log line makes it findable so the missing `.catch` gets fixed.
 */
export function installProcessSafetyNets(): void {
  if (installed) return;
  installed = true;

  process.on("uncaughtException", (err) => {
    captureException(err, { source: "uncaughtException", fatal: true });
    process.exit(1);
  });

  process.on("unhandledRejection", (reason) => {
    captureException(reason, { source: "unhandledRejection", fatal: false });
  });
}
