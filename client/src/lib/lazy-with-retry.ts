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
        name === "ChunkLoadError"
    );
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
            if (sessionStorage.getItem(RELOAD_FLAG_KEY) === "1") throw err;
            sessionStorage.setItem(RELOAD_FLAG_KEY, "1");
            window.location.reload();
            return new Promise(() => {}) as never;
        }
    });
}

if (typeof window !== "undefined") {
    window.addEventListener("load", () => {
        sessionStorage.removeItem(RELOAD_FLAG_KEY);
    });
}
