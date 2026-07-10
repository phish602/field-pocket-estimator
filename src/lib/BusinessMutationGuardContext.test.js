import React from "react";
import { renderHook } from "@testing-library/react";
import { BusinessMutationGuardProvider, useBusinessMutationGuard } from "./BusinessMutationGuardContext";

const mockEnsureCurrentDeviceCanMutateBusinessData = jest.fn();

jest.mock("./supabaseDeviceLock", () => ({
  ensureCurrentDeviceCanMutateBusinessData: (...args) => mockEnsureCurrentDeviceCanMutateBusinessData(...args),
  getDeviceLockStoppedMessage: () => "Save stopped because EstiPaid was switched to another device.",
}));

function wrapperFor(props) {
  return function GuardWrapper({ children }) {
    return <BusinessMutationGuardProvider {...props}>{children}</BusinessMutationGuardProvider>;
  };
}

describe("BusinessMutationGuardContext", () => {
  beforeEach(() => {
    mockEnsureCurrentDeviceCanMutateBusinessData.mockReset();
    mockEnsureCurrentDeviceCanMutateBusinessData.mockResolvedValue({ ok: true });
  });

  test("allows offline local mode without a Supabase ownership read", async () => {
    const { result } = renderHook(() => useBusinessMutationGuard(), {
      wrapper: wrapperFor({ configured: false }),
    });

    await expect(result.current.ensureCanMutateBusinessData()).resolves.toEqual(expect.objectContaining({ ok: true, offline: true }));
    expect(mockEnsureCurrentDeviceCanMutateBusinessData).not.toHaveBeenCalled();
  });

  test("blocks synchronously when the shell already knows the device is locked", async () => {
    const { result } = renderHook(() => useBusinessMutationGuard(), {
      wrapper: wrapperFor({
        configured: true,
        user: { id: "user_1" },
        company: { id: "company_1" },
        deviceLock: { isLocked: true },
      }),
    });

    expect(result.current.canMutateBusinessDataSync()).toBe(false);
    await expect(result.current.ensureCanMutateBusinessData()).resolves.toEqual(expect.objectContaining({
      ok: false,
      userMessage: "Save stopped because EstiPaid was switched to another device.",
    }));
    expect(mockEnsureCurrentDeviceCanMutateBusinessData).not.toHaveBeenCalled();
  });

  test("fresh-checks the shared active-device record before a durable save", async () => {
    const { result } = renderHook(() => useBusinessMutationGuard(), {
      wrapper: wrapperFor({
        configured: true,
        user: { id: "user_1" },
        company: { id: "company_1" },
        deviceLock: { isLocked: false },
      }),
    });

    await result.current.ensureCanMutateBusinessData("local_save");
    expect(mockEnsureCurrentDeviceCanMutateBusinessData).toHaveBeenCalledWith(expect.objectContaining({
      configured: true,
      user: { id: "user_1" },
      company: { id: "company_1" },
      reason: "local_save",
      claimIfMissing: false,
    }));
  });
});
