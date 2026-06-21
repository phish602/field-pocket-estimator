export default function StatusBadge({ readiness }) {
  const tone = readiness?.tone || "draft";
  const label = readiness?.label || "Draft";

  return (
    <span className={`pe-cockpit-status-badge pe-cockpit-status-badge--${tone}`}>
      <span className="pe-cockpit-status-badge__dot" aria-hidden="true" />
      {label}
    </span>
  );
}

