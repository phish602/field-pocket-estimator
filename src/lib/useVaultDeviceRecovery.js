import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  executePreparedCurrentDeviceRecoveryReset,
  finalizeCurrentDeviceRecoveryCheckpoint,
  prepareCurrentDeviceRecovery,
  resumeCurrentDeviceRecoveryReset,
} from "./vaultDeviceRecoveryCoordinator";
import { readSupabaseCloudConvergenceSnapshot } from "./supabaseCloudRestore";
import { summarizeAppRestoreBundleCapture } from "./supabaseAppRestoreBundle";
import { compileVaultDeviceRecoveryRestoreSnapshot } from "./vaultDeviceRecoveryRestoreSnapshot";
import {
  completeVaultDeviceRecoveryRestore,
  revokeVaultRuntime,
  verifyVaultDeviceRecoveryRestore,
} from "./vaultRuntimeStore";
import {
  clearVaultDeviceRecoveryCheckpoint,
  readVaultDeviceRecoveryCheckpoint,
  writeVaultDeviceRecoveryCheckpoint,
} from "./vaultDeviceRecoveryCheckpoint";
import { workspaceTag as deriveWorkspaceVaultTag } from "./vaultCrypto";

const IDLE = Object.freeze({ state: "idle", checking: false, pending: false, retryable: false, code: "", counts: null });
const CHECKING = Object.freeze({ state: "checking", checking: true, pending: true, retryable: false, code: "", counts: null });
const SAFE_CODES = new Set(["RECOVERY_BUSY", "RECOVERY_LOCK_UNAVAILABLE", "IDENTITY_UNAVAILABLE"]);

function safeCounts(value) {
  const source = value && typeof value === "object" ? value : {};
  return Object.freeze({
    customers: Number.isSafeInteger(source.customers) && source.customers >= 0 ? source.customers : 0,
    projects: Number.isSafeInteger(source.projects) && source.projects >= 0 ? source.projects : 0,
    estimates: Number.isSafeInteger(source.estimates) && source.estimates >= 0 ? source.estimates : 0,
    invoices: Number.isSafeInteger(source.invoices) && source.invoices >= 0 ? source.invoices : 0,
  });
}

function publicResult({ state = "idle", pending = false, retryable = false, code = "", counts = null } = {}) {
  return Object.freeze({
    state,
    checking: state === "checking",
    pending,
    retryable,
    code: SAFE_CODES.has(code) ? code : "",
    counts: counts ? safeCounts(counts) : null,
  });
}

function sameCounts(left, right) {
  const a = safeCounts(left);
  const b = safeCounts(right);
  return a.customers === b.customers
    && a.projects === b.projects
    && a.estimates === b.estimates
    && a.invoices === b.invoices;
}

function safeBundleSummary(value) {
  const source = value && typeof value === "object" ? value : {};
  return Object.freeze({
    companyProfileCaptured: source.companyProfileCaptured === true,
    logoDataUrlCaptured: source.logoDataUrlCaptured === true,
    settingsCaptured: source.settingsCaptured === true,
    scopeTemplatesCaptured: source.scopeTemplatesCaptured === true,
  });
}

function reviewSummary({ counts = null, appBundleAvailable = false, appBundleSummary = null } = {}) {
  return Object.freeze({
    counts: safeCounts(counts),
    appBundleAvailable: appBundleAvailable === true,
    appBundleSummary: safeBundleSummary(appBundleSummary),
  });
}

// The reviewed summary and this one must come from the same derivation. Any
// second copy of these rules silently turns an unchanged backup into a
// REVIEW_CHANGED loop the contractor can never escape.
function snapshotReviewSummary(snapshot) {
  return reviewSummary({
    counts: snapshot?.counts,
    appBundleAvailable: snapshot?.supplemental?.status === "available",
    appBundleSummary: summarizeAppRestoreBundleCapture(snapshot?.mapped),
  });
}

function sameReviewSummary(left, right) {
  return sameCounts(left?.counts, right?.counts)
    && left?.appBundleAvailable === right?.appBundleAvailable
    && JSON.stringify(left?.appBundleSummary) === JSON.stringify(right?.appBundleSummary);
}

function storage() {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

function authorizationPreview(snapshot, proof) {
  return Object.freeze({
    status: "eligible",
    eligible: true,
    noWritesPerformed: snapshot?.noWritesPerformed === true,
    blockers: Object.freeze([]),
    proof,
  });
}

function buildDependencies(overrides) {
  const test = process.env.NODE_ENV === "test"
    && overrides
    && typeof overrides === "object"
    && Object.getPrototypeOf(overrides) === Object.prototype
    ? overrides
    : null;
  return Object.freeze({
    prepare: typeof test?.prepare === "function"
      ? test.prepare
      : prepareCurrentDeviceRecovery,
    execute: typeof test?.execute === "function"
      ? test.execute
      : executePreparedCurrentDeviceRecoveryReset,
    resume: typeof test?.resume === "function"
      ? test.resume
      : resumeCurrentDeviceRecoveryReset,
    finalize: typeof test?.finalize === "function"
      ? test.finalize
      : finalizeCurrentDeviceRecoveryCheckpoint,
    readSnapshot: typeof test?.readSnapshot === "function"
      ? test.readSnapshot
      : readSupabaseCloudConvergenceSnapshot,
    compile: typeof test?.compile === "function"
      ? test.compile
      : compileVaultDeviceRecoveryRestoreSnapshot,
    complete: typeof test?.complete === "function"
      ? test.complete
      : completeVaultDeviceRecoveryRestore,
    verifyCommitted: typeof test?.verifyCommitted === "function"
      ? test.verifyCommitted
      : verifyVaultDeviceRecoveryRestore,
    deriveTag: typeof test?.deriveTag === "function"
      ? test.deriveTag
      : deriveWorkspaceVaultTag,
    readCheckpoint: typeof test?.readCheckpoint === "function"
      ? test.readCheckpoint
      : readVaultDeviceRecoveryCheckpoint,
    writeCheckpoint: typeof test?.writeCheckpoint === "function"
      ? test.writeCheckpoint
      : writeVaultDeviceRecoveryCheckpoint,
    clearCheckpoint: typeof test?.clearCheckpoint === "function"
      ? test.clearCheckpoint
      : clearVaultDeviceRecoveryCheckpoint,
    storage: typeof test?.storage === "function"
      ? test.storage
      : storage,
    revoke: typeof test?.revoke === "function"
      ? test.revoke
      : revokeVaultRuntime,
  });
}

export default function useVaultDeviceRecovery({
  enabled = false,
  configured = false,
  user = null,
  company = null,
  capability = null,
  refresh,
  testDependencies = null,
} = {}) {
  const identity = useMemo(() => {
    const userId = String(user?.id || "").trim();
    const companyId = String(company?.id || "").trim();
    return enabled && configured && userId && companyId ? `${userId}|${companyId}` : "";
  }, [company?.id, configured, enabled, user?.id]);
  const [result, setResult] = useState(() => (
    enabled && configured && user?.id && company?.id ? CHECKING : IDLE
  ));
  const intent = useRef(null);
  const current = useRef({ identity: "", generation: 0, mounted: true });
  const refreshRef = useRef(refresh);
  const inputsRef = useRef({ configured, user, company, capability });
  refreshRef.current = refresh;
  inputsRef.current = { configured, user, company, capability };
  const dependencies = useMemo(
    () => buildDependencies(testDependencies),
    [testDependencies]
  );

  const prepare = useCallback(async () => {
    const input = inputsRef.current;
    const generation = current.current.generation;
    setResult(publicResult({ state: "checking", pending: true }));
    const prepared = await dependencies.prepare({
      configured: input.configured,
      user: input.user,
      company: input.company,
      capability: input.capability,
      storage: dependencies.storage(),
    });
    if (!current.current.mounted || current.current.generation !== generation) return;
    if (prepared?.state !== "review") {
      intent.current = null;
      setResult(publicResult({ state: "blocked", retryable: true, code: prepared?.code }));
      return;
    }
    intent.current = prepared;
    setResult(publicResult({ state: "review", counts: prepared.cloudCounts }));
  }, [dependencies]);

  useEffect(() => {
    const lifecycle = current.current;
    lifecycle.mounted = true;
    return () => {
      lifecycle.mounted = false;
      lifecycle.generation += 1;
      lifecycle.identity = "";
      intent.current = null;
      dependencies.revoke();
    };
  }, [dependencies]);

  useEffect(() => {
    const input = inputsRef.current;
    current.current.generation += 1;
    current.current.identity = identity;
    intent.current = null;
    if (!identity) {
      setResult(IDLE);
      return undefined;
    }
    let active = true;
    const generation = current.current.generation;
    setResult(CHECKING);
    (async () => {
      let workspaceTag;
      try {
        workspaceTag = await dependencies.deriveTag(
          input.user?.id,
          input.company?.id
        );
      } catch {
        if (active && current.current.generation === generation) {
          setResult(publicResult({ state: "blocked", retryable: true, code: "IDENTITY_UNAVAILABLE" }));
        }
        return;
      }
      const checkpoint = dependencies.readCheckpoint({
        storage: dependencies.storage(),
        workspaceTag,
      });
      if (!active || current.current.generation !== generation) return;
      if (!checkpoint.ok) {
        setResult(publicResult({ state: "blocked", retryable: true }));
        return;
      }
      if (checkpoint.checkpoint) {
        setResult(publicResult({ state: "recovering", pending: true }));
        if (checkpoint.checkpoint.phase === "cloud_restore_committed") {
          const finalized = await dependencies.finalize({
            configured: input.configured,
            user: input.user,
            company: input.company,
            storage: dependencies.storage(),
            finalizeRecovery: async ({ identity: activeIdentity }) => {
              const currentCheckpoint = dependencies.readCheckpoint({
                storage: dependencies.storage(),
                workspaceTag: activeIdentity.workspaceTag,
              });
              if (
                !currentCheckpoint.ok
                || currentCheckpoint.checkpoint?.phase !== "cloud_restore_committed"
              ) return Object.freeze({ state: "blocked" });
              const cloudSnapshot = await dependencies.readSnapshot({
                configured: input.configured,
                user: input.user,
                company: input.company,
              });
              const snapshot = dependencies.compile({ cloudSnapshot });
              const verified = await dependencies.verifyCommitted({
                userId: activeIdentity.userId,
                companyId: activeIdentity.companyId,
                snapshot,
              });
              if (verified?.ok !== true) return Object.freeze({ state: "blocked" });
              const cleared = dependencies.clearCheckpoint({
                storage: dependencies.storage(),
                workspaceTag: activeIdentity.workspaceTag,
              });
              return Object.freeze({ state: cleared?.ok ? "complete" : "blocked" });
            },
          });
          if (!active || current.current.generation !== generation) return;
          if (finalized?.state !== "complete") {
            setResult(publicResult({
              state: finalized?.code === "RECOVERY_BUSY" ? "paused" : "blocked",
              retryable: true,
              code: finalized?.code,
            }));
            return;
          }
          setResult(publicResult({ state: "complete" }));
          await refreshRef.current?.();
          return;
        }
        const execution = await dependencies.resume({
          configured: input.configured,
          user: input.user,
          company: input.company,
          capability: input.capability,
          storage: dependencies.storage(),
          prepareFinalSnapshot: async ({ proof }) => {
            const cloudSnapshot = await dependencies.readSnapshot({
              configured: input.configured,
              user: input.user,
              company: input.company,
            });
            const compiled = dependencies.compile({ cloudSnapshot });
            if (
              cloudSnapshot?.ok !== true
              || cloudSnapshot?.status !== "ready"
              || cloudSnapshot?.noWritesPerformed !== true
              || compiled?.state !== "ready"
            ) return Object.freeze({ ok: false, code: "FINAL_SNAPSHOT_INVALID" });
            return Object.freeze({
              ok: true,
              authorizationPreview: authorizationPreview(cloudSnapshot, proof),
              compiled,
            });
          },
          finalizeRecovery: async ({ identity: activeIdentity, preparedSnapshot }) => {
            const committed = await dependencies.complete({
              userId: activeIdentity.userId,
              companyId: activeIdentity.companyId,
              snapshot: preparedSnapshot?.compiled,
            });
            if (committed?.ok !== true) return Object.freeze({ state: "blocked" });
            const advanced = dependencies.writeCheckpoint({
              storage: dependencies.storage(),
              workspaceTag: activeIdentity.workspaceTag,
              phase: "cloud_restore_committed",
            });
            const verified = advanced.ok && await dependencies.verifyCommitted({
              userId: activeIdentity.userId,
              companyId: activeIdentity.companyId,
              snapshot: preparedSnapshot?.compiled,
            });
            const cleared = verified?.ok === true && dependencies.clearCheckpoint({
              storage: dependencies.storage(),
              workspaceTag: activeIdentity.workspaceTag,
            });
            return Object.freeze({ state: cleared?.ok ? "complete" : "blocked" });
          },
        });
        if (!active || current.current.generation !== generation) return;
        if (execution?.state === "complete") {
          setResult(publicResult({ state: "complete" }));
          await refreshRef.current?.();
        } else {
          setResult(publicResult({
            state: execution?.code === "RECOVERY_BUSY" ? "paused" : "blocked",
            retryable: true,
            code: execution?.code,
          }));
        }
        return;
      }
      if (input.capability?.state === "reset_required") {
        prepare();
      } else {
        setResult(IDLE);
      }
    })();
    return () => { active = false; };
  }, [capability?.state, dependencies, identity, prepare]);

  const confirm = useCallback(async () => {
    const input = inputsRef.current;
    const prepared = intent.current;
    const generation = current.current.generation;
    if (!prepared?.proof || !identity) return;
    setResult(publicResult({ state: "recovering", pending: true }));
    const reviewedSummary = reviewSummary({
      counts: prepared.cloudCounts,
      appBundleAvailable: prepared.appBundleAvailable,
      appBundleSummary: prepared.appBundleSummary,
    });
    const execution = await dependencies.execute({
      proof: prepared.proof,
      accepted: true,
      configured: input.configured,
      user: input.user,
      company: input.company,
      capability: input.capability,
      storage: dependencies.storage(),
      prepareFinalSnapshot: async () => {
        const cloudSnapshot = await dependencies.readSnapshot({
          configured: input.configured,
          user: input.user,
          company: input.company,
        });
        const compiled = dependencies.compile({ cloudSnapshot });
        const finalSummary = snapshotReviewSummary(cloudSnapshot);
        if (
          cloudSnapshot?.ok !== true
          || cloudSnapshot?.status !== "ready"
          || cloudSnapshot?.noWritesPerformed !== true
          || compiled?.state !== "ready"
        ) return Object.freeze({ ok: false, code: "FINAL_SNAPSHOT_INVALID" });
        if (!sameReviewSummary(reviewedSummary, finalSummary)) {
          return Object.freeze({ ok: false, code: "REVIEW_CHANGED", summary: finalSummary });
        }
        return Object.freeze({
          ok: true,
          authorizationPreview: authorizationPreview(cloudSnapshot, prepared.proof),
          compiled,
        });
      },
      finalizeRecovery: async ({ identity: activeIdentity, preparedSnapshot }) => {
        const snapshot = preparedSnapshot?.compiled;
        const committed = await dependencies.complete({
          userId: activeIdentity.userId,
          companyId: activeIdentity.companyId,
          snapshot,
        });
        if (committed?.ok !== true) return Object.freeze({ state: "blocked", code: "RESTORE_UNAVAILABLE" });
        const checkpointStorage = dependencies.storage();
        const advanced = dependencies.writeCheckpoint({
          storage: checkpointStorage,
          workspaceTag: activeIdentity.workspaceTag,
          phase: "cloud_restore_committed",
        });
        const verified = advanced.ok && await dependencies.verifyCommitted({
          userId: activeIdentity.userId,
          companyId: activeIdentity.companyId,
          snapshot,
        });
        const cleared = verified?.ok === true && dependencies.clearCheckpoint({
          storage: checkpointStorage,
          workspaceTag: activeIdentity.workspaceTag,
        });
        if (!cleared?.ok) return Object.freeze({ state: "blocked", code: "RESTORE_UNAVAILABLE" });
        return Object.freeze({ state: "complete", code: "" });
      },
    });
    if (!current.current.mounted || current.current.generation !== generation) return;
    if (execution?.state === "complete") {
      intent.current = null;
      setResult(publicResult({ state: "complete" }));
      await refreshRef.current?.();
      return;
    }
    if (execution?.code === "REVIEW_CHANGED") {
      intent.current = null;
      await prepare();
      return;
    }
    setResult(publicResult({
      state: execution?.code === "RECOVERY_BUSY" ? "paused" : "blocked",
      retryable: true,
      code: execution?.code,
    }));
  }, [dependencies, identity, prepare]);

  const retry = useCallback(() => {
    if (capability?.state === "reset_required") prepare();
  }, [capability?.state, prepare]);

  return useMemo(() => Object.freeze({
    ...result,
    confirm,
    retry,
  }), [confirm, result, retry]);
}
