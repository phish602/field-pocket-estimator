import { renderHook, waitFor } from "@testing-library/react";
import useCloudAutoConvergence from "./useCloudAutoConvergence";
import { runSupabaseCloudConvergence, recoverInterruptedCloudConvergence } from "./supabaseCloudConvergence";
import { releaseCloudBackupRunLock } from "./cloudBackupRunLock";

jest.mock("./supabaseCloudConvergence", () => ({
  runSupabaseCloudConvergence: jest.fn(),
  recoverInterruptedCloudConvergence: jest.fn(),
}));

beforeEach(() => {
  localStorage.clear();
  releaseCloudBackupRunLock();
  recoverInterruptedCloudConvergence.mockReturnValue({ ok: true, recovered: false });
  runSupabaseCloudConvergence.mockResolvedValue({ ok: true, status: "matched" });
});

afterEach(() => releaseCloudBackupRunLock());

test("mounts one authenticated, active-device convergence attempt without user action", async () => {
  renderHook(() => useCloudAutoConvergence({ configured: true, user: { id: "user-1" }, company: { id: "company-1" }, deviceLock: { isLocked: false } }));
  await waitFor(() => expect(runSupabaseCloudConvergence).toHaveBeenCalledTimes(1));
  expect(runSupabaseCloudConvergence).toHaveBeenCalledWith(expect.objectContaining({ configured: true, user: { id: "user-1" }, company: { id: "company-1" } }));
  expect(recoverInterruptedCloudConvergence).toHaveBeenCalled();
});

test("does not run while device ownership is locked", async () => {
  renderHook(() => useCloudAutoConvergence({ configured: true, user: { id: "user-1" }, company: { id: "company-1" }, deviceLock: { isLocked: true } }));
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(runSupabaseCloudConvergence).not.toHaveBeenCalled();
});
