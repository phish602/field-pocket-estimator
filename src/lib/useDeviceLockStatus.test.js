import { act, renderHook, waitFor } from "@testing-library/react";
import useDeviceLockStatus from "./useDeviceLockStatus";

const mockCheckCurrentDeviceAccess = jest.fn();
const mockClaimActiveDevice = jest.fn();

jest.mock("./supabaseDeviceLock", () => ({
  __esModule: true,
  checkCurrentDeviceAccess: (...args) => mockCheckCurrentDeviceAccess(...args),
  claimActiveDevice: (...args) => mockClaimActiveDevice(...args),
  DEVICE_LOCK_CHANGED_EVENT: "estipaid:device-lock-changed",
}));

const USER = { id: "user_1", email: "owner@example.com" };
const COMPANY = { id: "company_1", name: "Field Pocket" };

function buildAccessResult(overrides = {}) {
  return {
    ready: true,
    status: "active",
    isLocked: false,
    isActive: true,
    activeDeviceState: {
      activeDeviceId: "device_a",
      activeDeviceName: "Chrome on Mac",
    },
    localDeviceId: "device_a",
    localDeviceName: "Chrome on Mac",
    reason: "",
    error: "",
    ...overrides,
  };
}

describe("useDeviceLockStatus", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockCheckCurrentDeviceAccess.mockReset();
    mockClaimActiveDevice.mockReset();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  test("rechecks on window focus", async () => {
    mockCheckCurrentDeviceAccess
      .mockResolvedValueOnce(buildAccessResult())
      .mockResolvedValueOnce(buildAccessResult());

    const hook = renderHook(() => useDeviceLockStatus({
      configured: true,
      user: USER,
      company: COMPANY,
      enabled: true,
    }));

    await waitFor(() => expect(hook.result.current.isActive).toBe(true));

    act(() => {
      window.dispatchEvent(new Event("focus"));
    });

    await waitFor(() => expect(mockCheckCurrentDeviceAccess).toHaveBeenCalledTimes(2));
    expect(mockCheckCurrentDeviceAccess.mock.calls[1][0]).toEqual(expect.objectContaining({
      configured: true,
      user: USER,
      company: COMPANY,
      claimIfMissing: true,
      heartbeatIfActive: true,
    }));

    hook.unmount();
  });

  test("rechecks on visibilitychange when the tab becomes visible", async () => {
    mockCheckCurrentDeviceAccess
      .mockResolvedValueOnce(buildAccessResult())
      .mockResolvedValueOnce(buildAccessResult({
        status: "locked",
        isLocked: true,
        isActive: false,
        activeDeviceState: {
          activeDeviceId: "device_b",
          activeDeviceName: "Safari on iPad",
        },
        reason: "locked",
      }));

    const hook = renderHook(() => useDeviceLockStatus({
      configured: true,
      user: USER,
      company: COMPANY,
      enabled: true,
    }));

    await waitFor(() => expect(hook.result.current.isActive).toBe(true));

    act(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "visible",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await waitFor(() => expect(hook.result.current.isLocked).toBe(true));
    expect(hook.result.current.activeDeviceState?.activeDeviceId).toBe("device_b");

    hook.unmount();
  });

  test("rechecks on the periodic interval", async () => {
    mockCheckCurrentDeviceAccess
      .mockResolvedValueOnce(buildAccessResult())
      .mockResolvedValueOnce(buildAccessResult());

    const hook = renderHook(() => useDeviceLockStatus({
      configured: true,
      user: USER,
      company: COMPANY,
      enabled: true,
    }));

    await waitFor(() => expect(hook.result.current.isActive).toBe(true));

    act(() => {
      jest.advanceTimersByTime(30000);
    });

    await waitFor(() => expect(mockCheckCurrentDeviceAccess).toHaveBeenCalledTimes(2));
    expect(mockCheckCurrentDeviceAccess.mock.calls[1][0]).toEqual(expect.objectContaining({
      claimIfMissing: false,
      heartbeatIfActive: true,
    }));

    hook.unmount();
  });

  test("becomes locked when the active device changes to another device id", async () => {
    mockCheckCurrentDeviceAccess
      .mockResolvedValueOnce(buildAccessResult())
      .mockResolvedValueOnce(buildAccessResult({
        status: "locked",
        isLocked: true,
        isActive: false,
        activeDeviceState: {
          activeDeviceId: "device_b",
          activeDeviceName: "Safari on iPad",
        },
        reason: "This device is locked.",
      }));

    const hook = renderHook(() => useDeviceLockStatus({
      configured: true,
      user: USER,
      company: COMPANY,
      enabled: true,
    }));

    await waitFor(() => expect(hook.result.current.isActive).toBe(true));

    act(() => {
      window.dispatchEvent(new CustomEvent("estipaid:device-lock-changed"));
    });

    await waitFor(() => expect(hook.result.current.isLocked).toBe(true));
    expect(hook.result.current.isActive).toBe(false);
    expect(hook.result.current.activeDeviceState?.activeDeviceId).toBe("device_b");

    hook.unmount();
  });
});
