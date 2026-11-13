"use client";

import { useCallback, useEffect, useState } from "react";
import type { Snapshot } from "@/lib/types";
import { ServerOverview } from "@/app/components/ServerOverview";
import { AppsTable } from "@/app/components/AppsTable";
import { AlertsPanel } from "@/app/components/AlertsPanel";

const REFRESH_MS = 20000;

function StatusPills({ snapshot }: { snapshot: Snapshot }) {
  const { coolify, server } = snapshot;
  const coolifyClass = !coolify.configured ? "warn" : coolify.reachable ? "ok" : "crit";
  const coolifyLabel = !coolify.configured
    ? "Coolify: no token"
    : coolify.reachable
      ? `Coolify ${coolify.version ?? "OK"}`
      : "Coolify: error";

  return (
    <>
      <span className={`pill ${coolifyClass}`}>
        <span className="dot" />
        {coolifyLabel}
      </span>
      <span className={`pill ${server.available ? "ok" : "warn"}`}>
        <span className="dot" />
        {server.available ? "Netdata OK" : "Netdata: off"}
      </span>
    </>
  );
}

export default function DashboardPage() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (force = false) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/snapshot${force ? "?force=1" : ""}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`Snapshot request failed (HTTP ${res.status})`);
      setSnapshot((await res.json()) as Snapshot);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  return (
    <div className="wrap">
      <header className="top">
        <h1>Apps Performance Dashboard</h1>
        <div className="controls">
          {snapshot && <StatusPills snapshot={snapshot} />}
          <button className="refresh" onClick={() => void load(true)} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>

      <p className="sub">
        Live view of the Skale Club Coolify host · auto-refresh every {REFRESH_MS / 1000}s
        {snapshot ? ` · updated ${new Date(snapshot.generatedAt).toLocaleTimeString()}` : ""}
      </p>

      {error && (
        <div className="banner">
          <strong>Could not load snapshot.</strong> {error}
        </div>
      )}

      {snapshot && !snapshot.coolify.configured && (
        <div className="banner">
          <strong>Coolify token not configured (Blocker B2).</strong> App discovery is disabled — set{" "}
          <code>COOLIFY_TOKEN</code> and <code>COOLIFY_BASE</code> to populate the inventory.
        </div>
      )}
      {snapshot && snapshot.coolify.configured && !snapshot.coolify.reachable && (
        <div className="banner">
          <strong>Coolify API unreachable.</strong> {snapshot.coolify.error ?? "Unknown error."}
        </div>
      )}

      {!snapshot && !error && <div className="empty">Loading…</div>}

      {snapshot && (
        <>
          <section>
            <h2>Alerts</h2>
            <AlertsPanel flags={snapshot.flags} />
          </section>

          <ServerOverview server={snapshot.server} />

          <section>
            <h2>
              Apps{" "}
              <span className="muted">
                ({snapshot.coolify.counts.applications} apps · {snapshot.coolify.counts.services} services ·{" "}
                {snapshot.coolify.counts.databases} dbs)
              </span>
            </h2>
            <AppsTable items={snapshot.inventory} />
          </section>
        </>
      )}
    </div>
  );
}
