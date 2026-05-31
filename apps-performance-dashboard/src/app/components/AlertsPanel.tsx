import type { Flag } from "@/lib/types";

export function AlertsPanel({ flags }: { flags: Flag[] }) {
  if (flags.length === 0) {
    return <div className="empty">No alerts — everything looks healthy.</div>;
  }

  return (
    <ul className="alerts">
      {flags.map((flag, i) => (
        <li key={`${flag.category}:${flag.subject}:${i}`} className={flag.severity}>
          <span className="sev">{flag.severity}</span>
          <span>{flag.message}</span>
        </li>
      ))}
    </ul>
  );
}
