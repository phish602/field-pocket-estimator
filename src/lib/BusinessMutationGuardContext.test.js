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
        // A genuinely operational device: ready, active and unlocked. "not
        // locked" alone is no longer authority to mutate business data.
        deviceLock: { ready: true, loading: false, isActive: true, isLocked: false },
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

// 10. MUTATION FREEZE -- positive operational authority only.
describe("business mutation requires positive operational authority", () => {
  const operational = { ready: true, loading: false, isActive: true, isLocked: false };
  const configuredWorkspace = { configured: true, user: { id: "user_1" }, company: { id: "company_1" } };

  function guardWith(overrides) {
    return renderHook(() => useBusinessMutationGuard(), {
      wrapper: wrapperFor({ ...configuredWorkspace, ...overrides }),
    });
  }

  test.each([
    ["device lock unresolved", { deviceLock: null }],
    ["device lock still loading", { deviceLock: { ...operational, loading: true } }],
    ["device lock not ready", { deviceLock: { ...operational, ready: false } }],
    ["device inactive", { deviceLock: { ...operational, isActive: false } }],
    ["device locked", { deviceLock: { ...operational, isLocked: true } }],
  ])("denies mutation when %s", async (_label, overrides) => {
    const { result } = guardWith(overrides);

    expect(result.current.canMutateBusinessDataSync()).toBe(false);
    await expect(result.current.ensureCanMutateBusinessData()).resolves.toEqual(
      expect.objectContaining({ ok: false })
    );
    expect(mockEnsureCurrentDeviceCanMutateBusinessData).not.toHaveBeenCalled();
  });

  test("allows mutation when the physical device is ready, active, and unlocked", async () => {
    const { result } = guardWith({ deviceLock: operational });

    expect(result.current.canMutateBusinessDataSync()).toBe(true);
    await result.current.ensureCanMutateBusinessData("local_save");
    expect(mockEnsureCurrentDeviceCanMutateBusinessData).toHaveBeenCalled();
  });

  test("keeps signed-out and local-only workspaces mutable exactly as before", async () => {
    const { result } = renderHook(() => useBusinessMutationGuard(), {
      wrapper: wrapperFor({ configured: false, user: null, company: null, deviceLock: null }),
    });

    expect(result.current.canMutateBusinessDataSync()).toBe(true);
    await expect(result.current.ensureCanMutateBusinessData()).resolves.toEqual(
      expect.objectContaining({ ok: true, offline: true })
    );
  });
});

// Browser-surface authority sits in FRONT of the device question: it is local,
// provable offline, and a takeover of the tab is not a takeover of the device.
describe("business mutation requires an active browser surface", () => {
  const ACTIVE_BROWSER = { ready: true, isActive: true, code: "" };
  const INACTIVE_BROWSER = { ready: true, isActive: false, code: "browser_surface_inactive" };
  const ACTIVE_DEVICE = { ready: true, loading: false, isActive: true, isLocked: false };

  beforeEach(() => {
    mockEnsureCurrentDeviceCanMutateBusinessData.mockReset();
    mockEnsureCurrentDeviceCanMutateBusinessData.mockResolvedValue({ ok: true });
  });

  test("an active browser surface on an active device mutates exactly as before", async () => {
    const { result } = renderHook(() => useBusinessMutationGuard(), {
      wrapper: wrapperFor({
        configured: true,
        user: { id: "user_1" },
        company: { id: "company_1" },
        deviceLock: ACTIVE_DEVICE,
        browserSurface: ACTIVE_BROWSER,
      }),
    });

    expect(result.current.canMutateBusinessDataSync()).toBe(true);
    await expect(result.current.ensureCanMutateBusinessData()).resolves.toEqual(expect.objectContaining({ ok: true }));
    expect(mockEnsureCurrentDeviceCanMutateBusinessData).toHaveBeenCalledTimes(1);
  });

  test("an inactive browser surface is refused with its OWN code, never a device lock", async () => {
    const { result } = renderHook(() => useBusinessMutationGuard(), {
      wrapper: wrapperFor({
        configured: true,
        user: { id: "user_1" },
        company: { id: "company_1" },
        deviceLock: ACTIVE_DEVICE,
        browserSurface: INACTIVE_BROWSER,
      }),
    });

    expect(result.current.canMutateBusinessDataSync()).toBe(false);
    const outcome = await result.current.ensureCanMutateBusinessData("estimate_save");
    expect(outcome).toEqual(expect.objectContaining({
      ok: false,
      code: "browser_surface_inactive",
      reason: "estimate_save",
      deviceLockLost: false,
    }));
    expect(outcome.userMessage).toContain("another tab");
    // The device was never consulted: this is not a device-ownership event.
    expect(mockEnsureCurrentDeviceCanMutateBusinessData).not.toHaveBeenCalled();
  });

  test("an inactive DEVICE keeps its existing behavior when the browser surface is active", async () => {
    const { result } = renderHook(() => useBusinessMutationGuard(), {
      wrapper: wrapperFor({
        configured: true,
        user: { id: "user_1" },
        company: { id: "company_1" },
        deviceLock: { ready: true, loading: false, isActive: false, isLocked: true },
        browserSurface: ACTIVE_BROWSER,
      }),
    });

    expect(result.current.canMutateBusinessDataSync()).toBe(false);
    await expect(result.current.ensureCanMutateBusinessData()).resolves.toEqual(expect.objectContaining({
      ok: false,
      code: "device_locked",
      deviceLockLost: true,
    }));
  });

  test("offline local use is unchanged while this browser surface is active", async () => {
    const { result } = renderHook(() => useBusinessMutationGuard(), {
      wrapper: wrapperFor({ configured: false, browserSurface: ACTIVE_BROWSER }),
    });

    expect(result.current.canMutateBusinessDataSync()).toBe(true);
    await expect(result.current.ensureCanMutateBusinessData()).resolves.toEqual(expect.objectContaining({ ok: true, offline: true }));
    expect(mockEnsureCurrentDeviceCanMutateBusinessData).not.toHaveBeenCalled();
  });

  test("offline local use is still refused on an INACTIVE browser surface", async () => {
    const { result } = renderHook(() => useBusinessMutationGuard(), {
      wrapper: wrapperFor({ configured: false, browserSurface: INACTIVE_BROWSER }),
    });

    // Browser ownership needs no network, so being offline is no reason to let a
    // second tab write.
    expect(result.current.canMutateBusinessDataSync()).toBe(false);
    await expect(result.current.ensureCanMutateBusinessData()).resolves.toEqual(expect.objectContaining({
      ok: false,
      code: "browser_surface_inactive",
    }));
  });

  test("an unresolved browser surface is not treated as authority", () => {
    const { result } = renderHook(() => useBusinessMutationGuard(), {
      wrapper: wrapperFor({
        configured: true,
        user: { id: "user_1" },
        company: { id: "company_1" },
        deviceLock: ACTIVE_DEVICE,
        browserSurface: { ready: false, isActive: false, code: "" },
      }),
    });

    expect(result.current.canMutateBusinessDataSync()).toBe(false);
  });
});
