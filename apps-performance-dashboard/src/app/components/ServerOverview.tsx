import type { ServerHealth } from "@/lib/types";

function level(pct: number | null, warn: number, crit: number): string {
  if (pct === null) return "";
  if (pct >= crit) return "crit";
  if (pct >= warn) return "warn";
  return "";
}

function fmtMb(mb: number | null): string {
  if (mb === null) return "—";
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

export function ServerOverview({ server }: { server: ServerHealth }) {
  if (!server.available) {
    return (
      <section>
        <h2>Server health</h2>
        <div className="banner">
          <strong>Server metrics unavailable.</strong> {server.reason ?? "Netdata is not reachable."}
        </div>
      </section>
    );
  }

  return (
    <section>
      <h2>Server health</h2>
      <div className="grid">
        <div className="card">
          <div className="label">CPU</div>
          <div className="value">
            {server.cpuPct ?? "—"}
            {server.cpuPct !== null && <small> %</small>}
          </div>
          <div className="bar">
            <span className={level(server.cpuPct, 75, 90)} style={{ width: `${server.cpuPct ?? 0}%` }} />
          </div>
        </div>

        <div className="card">
          <div className="label">RAM</div>
          <div className="value">
            {server.ramPct ?? "—"}
            {server.ramPct !== null && (
              <small>
                {" "}
                % · {fmtMb(server.ramUsedMb)} / {fmtMb(server.ramTotalMb)}
              </small>
            )}
          </div>
          <div className="bar">
            <span className={level(server.ramPct, 75, 90)} style={{ width: `${server.ramPct ?? 0}%` }} />
          </div>
        </div>

        <div className="card">
          <div className="label">Disk · limit {server.diskLimitGb} GB</div>
          <div className="value">
            {server.diskUsedGb ?? "—"}
            {server.diskUsedGb !== null && <small> GB · {server.diskPct}%</small>}
          </div>
          <div className="bar">
            <span className={level(server.diskPct, 75, 85)} style={{ width: `${server.diskPct ?? 0}%` }} />
          </div>
        </div>
      </div>
    </section>
  );
}
