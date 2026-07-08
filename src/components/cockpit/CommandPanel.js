import LiveTotals from "./LiveTotals";
import StatusBadge from "./StatusBadge";

function formatDate(value) {
  if (!value) return "No date";
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(`${value}T00:00:00`));
  } catch {
    return value;
  }
}

function formatSavedAt(value) {
  if (!Number(value)) return "Not saved yet";
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(Number(value)));
  } catch {
    return "Saved";
  }
}

function buildSnapshotRows(totals) {
  const docLabel = totals?.docType === "invoice" ? "Invoice #" : "Estimate #";
  return [
    { label: docLabel, value: totals?.docNumber || "Unassigned" },
    { label: "Customer", value: totals?.customerName || "No customer yet" },
    { label: "Project", value: totals?.projectName || totals?.jobLocation || "No project context" },
    { label: "Job date", value: formatDate(totals?.jobDate) },
    { label: "Materials mode", value: totals?.materialsMode === "itemized" ? "Itemized" : "Blanket" },
    { label: "Last saved", value: formatSavedAt(totals?.lastSavedAt) },
  ];
}

export default function CommandPanel({
  desiredDocType = "estimate",
  totals,
  readiness,
  isAwaitingLiveSnapshot = false,
}) {
  const snapshotRows = totals ? buildSnapshotRows(totals) : [];
  const progressLabel = readiness
    ? `${readiness?.completedCount || 0}/${readiness?.totalCount || 0} checks clear`
    : "Waiting for live estimator";

  return (
    <aside className="pe-cockpit-panel" aria-label="Estimate command panel">
      <section className="pe-cockpit-panel__hero pe-cockpit-section">
        <div className="pe-cockpit-panel__hero-top">
          <div>
            <div className="pe-cockpit-section__eyebrow">Command center</div>
            <h2 className="pe-cockpit-panel__title">Live estimate readiness</h2>
          </div>
          <StatusBadge readiness={readiness} isAwaitingLiveSnapshot={isAwaitingLiveSnapshot} />
        </div>
        <p className="pe-cockpit-panel__message">
          {isAwaitingLiveSnapshot
            ? `Waiting for the active ${desiredDocType} to publish its live totals.`
            : readiness?.message}
        </p>
        <div className="pe-cockpit-chip-row">
          <span className="pe-cockpit-chip">{progressLabel}</span>
          <span className="pe-cockpit-chip">
            {isAwaitingLiveSnapshot ? "Live data pending" : `${totals?.laborLineCount || 0} labor lines`}
          </span>
          <span className="pe-cockpit-chip">
            {isAwaitingLiveSnapshot
              ? "Command panel syncing"
              : totals?.materialsMode === "itemized"
              ? `${totals?.materialLineCount || 0} material lines`
              : "Blanket materials"}
          </span>
        </div>
      </section>

      <LiveTotals totals={totals} isAwaitingLiveSnapshot={isAwaitingLiveSnapshot} />

      <section className="pe-cockpit-section">
        <div className="pe-cockpit-section__eyebrow">Readiness checks</div>
        <div className="pe-cockpit-checklist">
          {(isAwaitingLiveSnapshot ? [] : (readiness?.checklist || [])).map((item) => (
            <div
              key={item.key}
              className={`pe-cockpit-checklist__item${item.done ? " is-done" : ""}`}
            >
              <span className="pe-cockpit-checklist__dot" aria-hidden="true" />
              <span>{item.label}</span>
            </div>
          ))}
          {isAwaitingLiveSnapshot && (
            <div className="pe-cockpit-checklist__item pe-cockpit-checklist__item--waiting">
              <span className="pe-cockpit-checklist__dot" aria-hidden="true" />
              <span>Estimator snapshot will appear here once the active form finishes mounting.</span>
            </div>
          )}
        </div>
      </section>

      <section className="pe-cockpit-section">
        <div className="pe-cockpit-section__eyebrow">Snapshot</div>
        <div className="pe-cockpit-snapshot-grid">
          {snapshotRows.map((row) => (
            <div key={row.label} className="pe-cockpit-snapshot-grid__item">
              <div className="pe-cockpit-snapshot-grid__label">{row.label}</div>
              <div className="pe-cockpit-snapshot-grid__value">{row.value}</div>
            </div>
          ))}
          {isAwaitingLiveSnapshot && (
            <div className="pe-cockpit-snapshot-grid__item pe-cockpit-snapshot-grid__item--waiting">
              <div className="pe-cockpit-snapshot-grid__label">Status</div>
              <div className="pe-cockpit-snapshot-grid__value">Awaiting live estimator snapshot</div>
            </div>
          )}
        </div>
      </section>
    </aside>
  );
}
