import { fireEvent, render, screen } from "@testing-library/react";
import DeviceLockGate from "./DeviceLockGate";

function buildLockedDeviceLock(overrides = {}) {
  return {
    loading: false,
    ready: true,
    isLocked: true,
    isActive: false,
    activeDeviceState: {
      activeDeviceId: "device_a",
      activeDeviceName: "Chrome on Mac",
    },
    takeover: jest.fn(async () => ({ ok: true, takeover: true, state: { isActive: true, isLocked: false } })),
    ...overrides,
  };
}

test("locked device renders the takeover screen and hides normal app content", () => {
  render(
    <DeviceLockGate
      deviceLock={buildLockedDeviceLock()}
      onSignOut={jest.fn()}
      onRestoreCloudData={jest.fn()}
      onOpenAdvancedSettings={jest.fn()}
    >
      <div>Normal App Content</div>
    </DeviceLockGate>
  );

  expect(screen.getByText("This Device Is Locked")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Switch to This Device" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Sign Out" })).toBeInTheDocument();
  expect(screen.queryByText("Normal App Content")).not.toBeInTheDocument();
});

test("takeover confirmation explains the switch flow", async () => {
  render(
    <DeviceLockGate
      deviceLock={buildLockedDeviceLock()}
      onSignOut={jest.fn()}
      onRestoreCloudData={jest.fn()}
      onOpenAdvancedSettings={jest.fn()}
    />
  );

  fireEvent.click(screen.getByRole("button", { name: "Switch to This Device" }));

  expect(screen.getByRole("dialog", { name: "Switch EstiPaid to This Device?" })).toBeInTheDocument();
  expect(screen.getByText(/Switching here will lock the other device from editing and cloud saving/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Switch Device" })).toBeInTheDocument();
});

test("successful takeover shows the post-switch actions", async () => {
  const onRestoreCloudData = jest.fn();
  const onOpenAdvancedSettings = jest.fn();
  const takeover = jest.fn(async () => ({ ok: true, takeover: true, state: { isActive: true, isLocked: false } }));

  render(
    <DeviceLockGate
      deviceLock={buildLockedDeviceLock({ takeover })}
      onSignOut={jest.fn()}
      onRestoreCloudData={onRestoreCloudData}
      onOpenAdvancedSettings={onOpenAdvancedSettings}
    />
  );

  fireEvent.click(screen.getByRole("button", { name: "Switch to This Device" }));
  fireEvent.click(screen.getByRole("button", { name: "Switch Device" }));

  expect(await screen.findByText("Device Switched")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Restore Cloud Data" }));
  expect(onRestoreCloudData).toHaveBeenCalledTimes(1);
});
