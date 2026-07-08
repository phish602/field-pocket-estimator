export default function StatusBadge({ readiness, isAwaitingLiveSnapshot = false }) {
  if (isAwaitingLiveSnapshot) {
    return (
      <span className="pe-cockpit-status-badge pe-cockpit-status-badge--loading">
        <span className="pe-cockpit-status-badge__dot" aria-hidden="true" />
        Syncing
      </span>
    );
  }

  const tone = readiness?.tone || "draft";
  const label = readiness?.label || "Draft";

  return (
    <span className={`pe-cockpit-status-badge pe-cockpit-status-badge--${tone}`}>
      <span className="pe-cockpit-status-badge__dot" aria-hidden="true" />
      {label}
    </span>
  );
}
