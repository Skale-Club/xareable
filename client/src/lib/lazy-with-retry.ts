import { lazy, type ComponentType } from "react";

const RELOAD_FLAG_KEY = "lazyChunkReloadInProgress";

function isChunkLoadError(err: unknown): boolean {
    if (!err || typeof err !== "object") return false;
    const msg = (err as { message?: string }).message ?? "";
    const name = (err as { name?: string }).name ?? "";
    return (
        /Failed to fetch dynamically imported module/i.test(msg) ||
        /Importing a module script failed/i.test(msg) ||
        /error loading dynamically imported module/i.test(msg) ||
        /Failed to load module script/i.test(msg) ||
        /Loading chunk \d+ failed/i.test(msg) ||
        /Loading CSS chunk \d+ failed/i.test(msg) ||
        name === "ChunkLoadError"
    );
}

function attemptReload(): void {
    if (typeof window === "undefined") return;
    if (sessionStorage.getItem(RELOAD_FLAG_KEY) === "1") return;
    sessionStorage.setItem(RELOAD_FLAG_KEY, "1");
    window.location.reload();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyWithRetry<T extends ComponentType<any>>(
    factory: () => Promise<{ default: T }>
): ReturnType<typeof lazy<T>> {
    return lazy(async () => {
        try {
            return await factory();
        } catch (err) {
            if (!isChunkLoadError(err)) throw err;
            attemptReload();
            return new Promise(() => {}) as never;
        }
    });
}

if (typeof window !== "undefined") {
    // Clear the reload guard once a fresh page successfully loads
    window.addEventListener("load", () => {
        sessionStorage.removeItem(RELOAD_FLAG_KEY);
    });

    // Catch chunk errors that originate outside React.lazy (Vite's automatic
    // code-split chunks, dynamic-import inside non-lazy modules, CSS chunks).
    window.addEventListener("error", (event) => {
        const target = event.target as HTMLElement | null;
        if (target && (target.tagName === "SCRIPT" || target.tagName === "LINK")) {
            const src = (target as HTMLScriptElement).src || (target as HTMLLinkElement).href;
            if (src && /\/assets\//.test(src)) {
                attemptReload();
            }
        }
    }, true);

    window.addEventListener("unhandledrejection", (event) => {
        if (isChunkLoadError(event.reason)) {
            attemptReload();
        }
    });
}
