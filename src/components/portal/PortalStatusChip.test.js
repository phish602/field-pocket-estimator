import React from "react";
import { render, screen } from "@testing-library/react";

import PortalStatusChip from "./PortalStatusChip";

describe("PortalStatusChip", () => {
  test("renders Not sent by default", () => {
    render(<PortalStatusChip />);

    expect(screen.getByText("Not sent")).toBeInTheDocument();
  });

  test("renders all future status labels", () => {
    const statuses = [
      ["staged", "Portal ready soon"],
      ["sent", "Sent to customer"],
      ["viewed", "Viewed"],
      ["approved", "Customer approved"],
      ["rejected", "Changes requested"],
      ["acknowledged", "Acknowledged"],
      ["expired", "Expired"],
      ["revoked", "Revoked"],
    ];

    const { rerender } = render(<PortalStatusChip status="staged" />);

    statuses.forEach(([status, label]) => {
      rerender(<PortalStatusChip status={status} />);
      expect(screen.getByText(label)).toBeInTheDocument();
    });
  });
});
