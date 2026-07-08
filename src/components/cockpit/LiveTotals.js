const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function formatMoney(value) {
  return money.format(Number(value) || 0);
}

export default function LiveTotals({ totals, isAwaitingLiveSnapshot = false }) {
  if (isAwaitingLiveSnapshot) {
    return (
      <section className="pe-cockpit-section">
        <div className="pe-cockpit-section__eyebrow">Live totals</div>
        <div className="pe-cockpit-total-card pe-cockpit-total-card--emphasis pe-cockpit-total-card--waiting">
          <div className="pe-cockpit-total-card__label">Live total</div>
          <div className="pe-cockpit-total-card__value">Waiting for active estimate</div>
        </div>
      </section>
    );
  }

  const cards = [
    {
      key: "grand-total",
      label: "Live total",
      value: formatMoney(totals?.grandTotal),
      emphasis: true,
    },
    {
      key: "labor-total",
      label: "Labor",
      value: formatMoney(totals?.laborTotal),
    },
    {
      key: "materials-total",
      label: "Materials",
      value: formatMoney(totals?.materialsTotal),
    },
  ];

  return (
    <section className="pe-cockpit-section">
      <div className="pe-cockpit-section__eyebrow">Live totals</div>
      <div className="pe-cockpit-totals-grid">
        {cards.map((card) => (
          <article
            key={card.key}
            className={`pe-cockpit-total-card${card.emphasis ? " pe-cockpit-total-card--emphasis" : ""}`}
          >
            <div className="pe-cockpit-total-card__label">{card.label}</div>
            <div className="pe-cockpit-total-card__value">{card.value}</div>
          </article>
        ))}
      </div>
    </section>
  );
}
