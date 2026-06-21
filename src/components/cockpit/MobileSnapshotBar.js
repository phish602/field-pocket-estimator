import StatusBadge from "./StatusBadge";

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export default function MobileSnapshotBar({ totals, readiness }) {
  return (
    <div className="pe-cockpit-mobile-bar" aria-label="Estimate snapshot">
      <div className="pe-cockpit-mobile-bar__status">
        <StatusBadge readiness={readiness} />
        <div className="pe-cockpit-mobile-bar__context">
          <div className="pe-cockpit-mobile-bar__title">
            {totals?.customerName || totals?.projectName || "Estimate in progress"}
          </div>
          <div className="pe-cockpit-mobile-bar__meta">
            {totals?.materialsMode === "itemized"
              ? `${totals?.materialLineCount || 0} materials`
              : "Blanket materials"}
          </div>
        </div>
      </div>
      <div className="pe-cockpit-mobile-bar__amount">
        {money.format(Number(totals?.grandTotal) || 0)}
      </div>
    </div>
  );
}

