import { buildEstimateCockpitTotals, hasMeaningfulEstimateDraft } from "./estimateCockpitTotals";

function toText(value) {
  return String(value || "").trim();
}

function toNumber(value) {
  const next = Number(value);
  return Number.isFinite(next) ? next : 0;
}

export function deriveEstimateCockpitReadiness(state, totals = buildEstimateCockpitTotals(state)) {
  const customerReady = Boolean(toText(totals?.customerName));
  const dateReady = Boolean(toText(totals?.jobDate));
  const projectReady = Boolean(
    toText(totals?.projectName)
    || toText(totals?.projectAddress)
    || toText(totals?.jobLocation)
  );
  const pricedReady = toNumber(totals?.grandTotal) > 0;
  const hasDraft = hasMeaningfulEstimateDraft(state, totals);
  const missingRequired = [];

  if (!customerReady) missingRequired.push("Customer");
  if (!dateReady) missingRequired.push("Date");
  if (!pricedReady) missingRequired.push("Non-zero total");

  let status = "draft";
  let label = "Draft";
  let tone = "draft";
  let message = "Start with the customer, date, and first priced line.";

  if (hasDraft) {
    status = "incomplete";
    label = "Incomplete";
    tone = "incomplete";
    message = missingRequired.length > 0
      ? `Missing ${missingRequired.join(", ")}.`
      : "Add a little more job context to finish the setup.";
  }

  if (hasDraft && customerReady && dateReady && pricedReady) {
    status = "ready";
    label = "Ready";
    tone = "ready";
    message = projectReady
      ? "Core estimate details are in place."
      : "Core pricing is ready. Add project context if needed.";
  }

  const checklist = [
    { key: "customer", label: "Customer", done: customerReady },
    { key: "date", label: "Date", done: dateReady },
    { key: "total", label: "Non-zero total", done: pricedReady },
    { key: "project", label: "Project or location", done: projectReady },
  ];

  const completedCount = checklist.filter((item) => item.done).length;

  return {
    status,
    label,
    tone,
    message,
    checklist,
    completedCount,
    totalCount: checklist.length,
    missingRequired,
    hasDraft,
    pricedReady,
  };
}

