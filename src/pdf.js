import jsPDF from "jspdf";

export function exportEstimatePDF(data) {
  const doc = new jsPDF();

  doc.setFontSize(16);
  doc.text("Field Pocket Estimator", 14, 20);

  doc.setFontSize(11);
  doc.text(`Date: ${data.date}`, 14, 30);
  doc.text(`Client: ${data.client || "-"}`, 14, 38);
  doc.text(`Description: ${data.description || "-"}`, 14, 46);

  let y = 60;

  doc.text("Labor:", 14, y);
  y += 8;

  data.laborLines.forEach((l) => {
    const total = (l.hours || 0) * (l.rate || 0);
    doc.text(
      `${l.label || "Labor"} — ${l.hours} hrs @ $${l.rate} = $${total.toFixed(2)}`,
      18,
      y
    );
    y += 7;
  });

  y += 6;
  doc.text(`Labor Multiplier: ${data.laborMultiplier}x`, 14, y);
  y += 8;

  doc.text(`Materials Cost: $${Number(data.materialsCost || 0).toFixed(2)}`, 14, y);
  y += 8;

  doc.text(`Hazard Fee: $${Number(data.hazardFee || 0).toFixed(2)}`, 14, y);
  y += 10;

  doc.setFontSize(14);
  doc.text(`TOTAL: $${data.total.toFixed(2)}`, 14, y);

  doc.save(`Estimate-${data.client || "Job"}.pdf`);
}
