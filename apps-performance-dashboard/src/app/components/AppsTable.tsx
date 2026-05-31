import type { AppHealth, InventoryItem } from "@/lib/types";

function HealthBadge({ health }: { health: AppHealth }) {
  const label = health.charAt(0).toUpperCase() + health.slice(1);
  return (
    <span className={`badge ${health}`}>
      <span className="dot" />
      {label}
    </span>
  );
}

function PrimaryDomain({ item }: { item: InventoryItem }) {
  const url = item.fqdns[0];
  if (!url) return <span className="muted">—</span>;
  return (
    <a href={url} target="_blank" rel="noreferrer">
      {url.replace(/^https?:\/\//, "")}
    </a>
  );
}

function sourceLabel(item: InventoryItem): string {
  if (!item.gitRepository) return "—";
  const repo = item.gitRepository.replace(/^https?:\/\/(www\.)?github\.com\//i, "").replace(/\.git$/, "");
  return item.gitBranch ? `${repo}@${item.gitBranch}` : repo;
}

function latencyLabel(item: InventoryItem): string {
  if (!item.probe) return "";
  return item.probe.latencyMs !== null ? `${item.probe.latencyMs} ms` : "—";
}

export function AppsTable({ items }: { items: InventoryItem[] }) {
  if (items.length === 0) {
    return <div className="empty">No resources discovered from Coolify.</div>;
  }

  return (
    <table className="apps">
      <thead>
        <tr>
          <th>Name</th>
          <th>Type</th>
          <th>Health</th>
          <th>Coolify status</th>
          <th className="num">Latency</th>
          <th>Domain</th>
          <th>Source</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={`${item.kind}:${item.uuid}`}>
            <td>{item.name}</td>
            <td className="muted">{item.kind}</td>
            <td>
              <HealthBadge health={item.health} />
            </td>
            <td className="muted">{item.rawStatus ?? "—"}</td>
            <td className="num">{latencyLabel(item)}</td>
            <td>
              <PrimaryDomain item={item} />
            </td>
            <td className="muted">{sourceLabel(item)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
