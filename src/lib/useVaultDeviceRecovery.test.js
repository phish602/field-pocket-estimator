import React, { useEffect } from "react";
import { act, render, waitFor } from "@testing-library/react";
import useVaultDeviceRecovery from "./useVaultDeviceRecovery";
import { summarizeAppRestoreBundleCapture } from "./supabaseAppRestoreBundle";

const USER = { id: "user-1" };
const COMPANY = { id: "company-1" };
const TAG = "A".repeat(43);
const PROOF = "proof-0123456789abcdefghijklmnop";

function Harness({ options, onValue }) {
  const value = useVaultDeviceRecovery(options);
  useEffect(() => {
    onValue(value);
  }, [onValue, value]);
  return (
    <button type="button" onClick={value.confirm}>
      {value.state}
    </button>
  );
}

function dependencies(overrides = {}) {
  const local = new Map();
  return {
    storage: () => ({
      getItem: (key) => local.get(key) || null,
      setItem: (key, value) => local.set(key, value),
      removeItem: (key) => local.delete(key),
    }),
    deriveTag: jest.fn().mockResolvedValue(TAG),
    readCheckpoint: jest.fn().mockReturnValue({ ok: true, checkpoint: null }),
    writeCheckpoint: jest.fn().mockReturnValue({ ok: true }),
    clearCheckpoint: jest.fn().mockReturnValue({ ok: true }),
    revoke: jest.fn(),
    prepare: jest.fn().mockResolvedValue({
      state: "review",
      proof: PROOF,
      cloudCounts: { customers: 1, projects: 2, estimates: 3, invoices: 4 },
    }),
    readSnapshot: jest.fn().mockResolvedValue({
      ok: true,
      status: "ready",
      noWritesPerformed: true,
      counts: { customers: 1, projects: 2, estimates: 3, invoices: 4 },
    }),
    compile: jest.fn().mockReturnValue({ state: "ready", entries: Object.freeze([]) }),
    complete: jest.fn().mockResolvedValue({ ok: true, state: "restored" }),
    verifyCommitted: jest.fn().mockResolvedValue({ ok: true, state: "verified" }),
    execute: jest.fn(),
    finalize: jest.fn(async (input) => input.finalizeRecovery({
      identity: { userId: USER.id, companyId: COMPANY.id, workspaceTag: TAG },
    })),
    ...overrides,
  };
}

function options(testDependencies, overrides = {}) {
  return {
    enabled: true,
    configured: true,
    user: USER,
    company: COMPANY,
    capability: { state: "reset_required", code: "DEVICE_KEY_MISSING" },
    refresh: jest.fn().mockResolvedValue({ state: "unlocked" }),
    testDependencies,
    ...overrides,
  };
}

test("prepares a sanitized review without destructive work", async () => {
  const deps = dependencies();
  const values = [];
  render(<Harness options={options(deps)} onValue={(value) => values.push(value)} />);

  await waitFor(() => expect(values.at(-1).state).toBe("review"));
  const value = values.at(-1);
  expect(value.counts).toEqual({ customers: 1, projects: 2, estimates: 3, invoices: 4 });
  expect(Object.keys(value).sort()).toEqual([
    "checking", "code", "confirm", "counts", "pending", "retry", "retryable", "state",
  ]);
  expect(JSON.stringify(value)).not.toContain(USER.id);
  expect(JSON.stringify(value)).not.toContain(PROOF);
  expect(deps.execute).not.toHaveBeenCalled();
  expect(deps.complete).not.toHaveBeenCalled();
});

test("compiles the final snapshot before reset and keeps the lease-owned operation opaque", async () => {
  const order = [];
  const deps = dependencies({
    compile: jest.fn(() => {
      order.push("compile");
      return { state: "ready", entries: Object.freeze([]) };
    }),
    execute: jest.fn(async (input) => {
      const preparedSnapshot = await input.prepareFinalSnapshot();
      order.push("reset");
      return input.finalizeRecovery({
        identity: { userId: USER.id, companyId: COMPANY.id, workspaceTag: TAG },
        preparedSnapshot,
      });
    }),
    complete: jest.fn(async () => {
      order.push("commit");
      return { ok: true, state: "restored" };
    }),
  });
  const values = [];
  const view = render(<Harness options={options(deps)} onValue={(value) => values.push(value)} />);
  await waitFor(() => expect(values.at(-1).state).toBe("review"));

  await act(async () => {
    view.getByRole("button").click();
  });
  await waitFor(() => expect(values.at(-1).state).toBe("complete"));

  expect(order).toEqual(["compile", "reset", "commit"]);
  expect(deps.writeCheckpoint).toHaveBeenCalledWith({
    storage: expect.any(Object), workspaceTag: TAG, phase: "cloud_restore_committed",
  });
  expect(deps.clearCheckpoint).toHaveBeenCalledWith({
    storage: expect.any(Object), workspaceTag: TAG,
  });
  expect(deps.verifyCommitted).toHaveBeenCalledWith({
    userId: USER.id,
    companyId: COMPANY.id,
    snapshot: expect.objectContaining({ state: "ready" }),
  });
});

test("does not call destructive execution when final snapshot validation fails", async () => {
  const deps = dependencies({
    readSnapshot: jest.fn().mockResolvedValue({ ok: false, status: "invalid", noWritesPerformed: true }),
    execute: jest.fn(async (input) => {
      const prepared = await input.prepareFinalSnapshot();
      return prepared.ok ? { state: "complete" } : { state: "blocked", code: prepared.code };
    }),
  });

  const values = [];
  const view = render(<Harness options={options(deps)} onValue={(value) => values.push(value)} />);
  await waitFor(() => expect(values.at(-1).state).toBe("review"));
  await act(async () => view.getByRole("button").click());
  await waitFor(() => expect(values.at(-1).state).toBe("blocked"));
  expect(deps.complete).not.toHaveBeenCalled();
  expect(deps.writeCheckpoint).not.toHaveBeenCalled();
});

test("an app bundle availability change invalidates review before reset", async () => {
  const deps = dependencies({
    prepare: jest.fn()
      .mockResolvedValueOnce({
        state: "review",
        proof: PROOF,
        cloudCounts: { customers: 1, projects: 2, estimates: 3, invoices: 4 },
        appBundleAvailable: false,
        appBundleSummary: null,
      })
      .mockResolvedValueOnce({
        state: "review",
        proof: `${PROOF}-new`,
        cloudCounts: { customers: 1, projects: 2, estimates: 3, invoices: 4 },
      }),
    readSnapshot: jest.fn().mockResolvedValue({
      ok: true,
      status: "ready",
      noWritesPerformed: true,
      counts: { customers: 1, projects: 2, estimates: 3, invoices: 4 },
      supplemental: { status: "available" },
      mapped: {},
    }),
    execute: jest.fn(async (input) => {
      const prepared = await input.prepareFinalSnapshot();
      return prepared.ok ? { state: "complete" } : { state: "blocked", code: prepared.code };
    }),
  });
  const values = [];
  const view = render(<Harness options={options(deps)} onValue={(value) => values.push(value)} />);
  await waitFor(() => expect(values.at(-1).state).toBe("review"));
  await act(async () => view.getByRole("button").click());
  await waitFor(() => expect(deps.prepare).toHaveBeenCalledTimes(2));
  expect(deps.complete).not.toHaveBeenCalled();
});

test("automatically resumes an empty replacement runtime and clears only after restore completion", async () => {
  const deps = dependencies({
    readCheckpoint: jest.fn().mockReturnValue({
      ok: true,
      checkpoint: { phase: "runtime_initialized" },
    }),
    resume: jest.fn(async (input) => {
      const preparedSnapshot = await input.prepareFinalSnapshot({ proof: PROOF });
      return input.finalizeRecovery({
        identity: { userId: USER.id, companyId: COMPANY.id, workspaceTag: TAG },
        preparedSnapshot,
      });
    }),
  });
  const values = [];
  render(<Harness options={options(deps)} onValue={(value) => values.push(value)} />);
  await waitFor(() => expect(values.at(-1).state).toBe("complete"));
  expect(deps.resume).toHaveBeenCalledTimes(1);
  expect(deps.complete).toHaveBeenCalledTimes(1);
  expect(deps.writeCheckpoint).toHaveBeenCalledWith({
    storage: expect.any(Object), workspaceTag: TAG, phase: "cloud_restore_committed",
  });
  expect(deps.clearCheckpoint).toHaveBeenCalledTimes(1);
});

test("keeps a committed checkpoint when fresh runtime verification fails", async () => {
  const deps = dependencies({
    verifyCommitted: jest.fn().mockResolvedValue({ ok: false, state: "blocked" }),
    execute: jest.fn(async (input) => {
      const preparedSnapshot = await input.prepareFinalSnapshot();
      return input.finalizeRecovery({
        identity: { userId: USER.id, companyId: COMPANY.id, workspaceTag: TAG },
        preparedSnapshot,
      });
    }),
  });
  const values = [];
  const view = render(<Harness options={options(deps)} onValue={(value) => values.push(value)} />);
  await waitFor(() => expect(values.at(-1).state).toBe("review"));
  await act(async () => view.getByRole("button").click());
  await waitFor(() => expect(values.at(-1).state).toBe("blocked"));
  expect(deps.writeCheckpoint).toHaveBeenCalledWith({
    storage: expect.any(Object), workspaceTag: TAG, phase: "cloud_restore_committed",
  });
  expect(deps.clearCheckpoint).not.toHaveBeenCalled();
});

test("checks for a recovery checkpoint before reporting an unlocked session idle", async () => {
  let releaseTag;
  const tagPending = new Promise((resolve) => {
    releaseTag = resolve;
  });
  const deps = dependencies({
    deriveTag: jest.fn(() => tagPending),
  });
  const values = [];
  render(<Harness options={options(deps, {
    capability: { state: "unlocked", code: "" },
  })} onValue={(value) => values.push(value)} />);
  await waitFor(() => expect(values.at(-1).state).toBe("checking"));
  releaseTag(TAG);
  await waitFor(() => expect(values.at(-1).state).toBe("idle"));
});

// A contractor's real backup is populated: a logo on the company profile and a
// scope-template array that may legitimately be empty. Deriving the reviewed
// and final summaries differently made every one of these look "changed", so
// these fixtures are deliberately populated rather than null/{}.
const COUNTS = { customers: 1, projects: 2, estimates: 3, invoices: 4 };
const SYNTHETIC_LOGO = "data:image/png;base64,synthetic-test-logo";

const BUNDLE_CASES = [
  ["logo present, empty scope templates",
    { companyProfile: { logoDataUrl: SYNTHETIC_LOGO }, settings: {}, scopeTemplates: [] }],
  ["no logo, populated scope templates",
    { companyProfile: { companyName: "Acme" }, settings: {}, scopeTemplates: [{ id: "tmpl_1" }] }],
  ["logo present, populated scope templates",
    { companyProfile: { companyName: "Acme", logoDataUrl: SYNTHETIC_LOGO }, settings: {}, scopeTemplates: [{ id: "tmpl_1" }] }],
  ["no logo, empty scope templates",
    { companyProfile: { companyName: "Acme" }, settings: {}, scopeTemplates: [] }],
];

function bundleScenario({ preparedSummary, mapped, appBundleAvailable = true, overrides = {} }) {
  return dependencies({
    prepare: jest.fn().mockResolvedValue({
      state: "review",
      proof: PROOF,
      cloudCounts: COUNTS,
      appBundleAvailable,
      appBundleSummary: preparedSummary,
    }),
    readSnapshot: jest.fn().mockResolvedValue({
      ok: true,
      status: "ready",
      noWritesPerformed: true,
      counts: COUNTS,
      supplemental: { status: "available" },
      mapped,
    }),
    // Mirrors the coordinator contract: the read-only final snapshot is
    // prepared first, and finalizeRecovery (the destructive path) only runs
    // when that preparation succeeds.
    execute: jest.fn(async (input) => {
      const preparedSnapshot = await input.prepareFinalSnapshot();
      if (!preparedSnapshot.ok) return { state: "blocked", code: preparedSnapshot.code };
      return input.finalizeRecovery({
        identity: { userId: USER.id, companyId: COMPANY.id, workspaceTag: TAG },
        preparedSnapshot,
      });
    }),
    ...overrides,
  });
}

async function confirmRecovery(deps) {
  const values = [];
  const view = render(<Harness options={options(deps)} onValue={(value) => values.push(value)} />);
  await waitFor(() => expect(values.at(-1).state).toBe("review"));
  await act(async () => {
    view.getByRole("button").click();
  });
  return values;
}

describe.each(BUNDLE_CASES)("unchanged populated backup (%s)", (_name, bundle) => {
  test("derives an identical reviewed and final summary and completes recovery", async () => {
    const preparedSummary = summarizeAppRestoreBundleCapture(bundle);
    // The mapped restore payload carries the same three bundle fields.
    const mapped = {
      companyProfile: bundle.companyProfile,
      settings: bundle.settings,
      scopeTemplates: bundle.scopeTemplates,
    };
    expect(summarizeAppRestoreBundleCapture(mapped)).toEqual(preparedSummary);

    const deps = bundleScenario({ preparedSummary, mapped });
    const values = await confirmRecovery(deps);

    await waitFor(() => expect(values.at(-1).state).toBe("complete"));
    expect(values.map((value) => value.state)).not.toContain("blocked");
    expect(deps.prepare).toHaveBeenCalledTimes(1);
    expect(deps.complete).toHaveBeenCalledTimes(1);
    expect(deps.clearCheckpoint).toHaveBeenCalledTimes(1);
  });
});

test("the canonical summary reports only booleans for a populated bundle", () => {
  const summary = summarizeAppRestoreBundleCapture({
    companyProfile: { companyName: "Acme", logoDataUrl: SYNTHETIC_LOGO },
    settings: { pdf: { includeLogo: true } },
    scopeTemplates: [{ id: "tmpl_1", scopeText: "Repair roof" }],
  });
  expect(summary).toEqual({
    companyProfileCaptured: true,
    logoDataUrlCaptured: true,
    settingsCaptured: true,
    scopeTemplatesCaptured: true,
  });
  Object.values(summary).forEach((value) => expect(typeof value).toBe("boolean"));
  const serialized = JSON.stringify(summary);
  expect(serialized).not.toContain("Acme");
  expect(serialized).not.toContain(SYNTHETIC_LOGO);
  expect(serialized).not.toContain("Repair roof");
});

test("an empty scope-template array is captured state, not a missing bundle", () => {
  expect(summarizeAppRestoreBundleCapture({ scopeTemplates: [] }).scopeTemplatesCaptured).toBe(true);
  expect(summarizeAppRestoreBundleCapture({ scopeTemplates: null }).scopeTemplatesCaptured).toBe(false);
  expect(summarizeAppRestoreBundleCapture({}).scopeTemplatesCaptured).toBe(false);
});

describe.each([
  ["logo", { companyProfile: { companyName: "Acme" }, settings: {}, scopeTemplates: [] }],
  ["scope-template capture", { companyProfile: { companyName: "Acme", logoDataUrl: SYNTHETIC_LOGO }, settings: {}, scopeTemplates: null }],
  ["settings capture", { companyProfile: { companyName: "Acme", logoDataUrl: SYNTHETIC_LOGO }, settings: null, scopeTemplates: [] }],
])("a real %s change", (_name, changedMapped) => {
  test("returns to review without any destructive work", async () => {
    // Preparation saw a fully captured bundle; the final snapshot no longer
    // matches it, so this must fail safely back to a fresh confirmation.
    const preparedSummary = summarizeAppRestoreBundleCapture({
      companyProfile: { companyName: "Acme", logoDataUrl: SYNTHETIC_LOGO },
      settings: {},
      scopeTemplates: [],
    });
    expect(summarizeAppRestoreBundleCapture(changedMapped)).not.toEqual(preparedSummary);

    const deps = bundleScenario({ preparedSummary, mapped: changedMapped });
    const values = await confirmRecovery(deps);

    await waitFor(() => expect(deps.prepare).toHaveBeenCalledTimes(2));
    expect(values.at(-1).state).toBe("review");
    expect(deps.complete).not.toHaveBeenCalled();
    expect(deps.writeCheckpoint).not.toHaveBeenCalled();
    expect(deps.clearCheckpoint).not.toHaveBeenCalled();
    expect(deps.revoke).not.toHaveBeenCalled();
    // The refreshed review stays sanitized and still requires a new explicit
    // confirmation before anything destructive can run.
    expect(values.at(-1).counts).toEqual(COUNTS);
    expect(JSON.stringify(values.at(-1))).not.toContain(PROOF);
    expect(JSON.stringify(values.at(-1))).not.toContain(SYNTHETIC_LOGO);
  });
});

test("finalizes an already committed runtime without a duplicate encrypted restore", async () => {
  const deps = dependencies({
    readCheckpoint: jest.fn().mockReturnValue({
      ok: true,
      checkpoint: { phase: "cloud_restore_committed" },
    }),
    verifyCommitted: jest.fn().mockResolvedValue({ ok: true, state: "verified" }),
  });
  const values = [];
  render(<Harness options={options(deps, {
    capability: { state: "unlocked", code: "" },
  })} onValue={(value) => values.push(value)} />);
  await waitFor(() => expect(values.at(-1).state).toBe("complete"));
  expect(deps.verifyCommitted).toHaveBeenCalledTimes(1);
  expect(deps.complete).not.toHaveBeenCalled();
  expect(deps.clearCheckpoint).toHaveBeenCalledTimes(1);
});
