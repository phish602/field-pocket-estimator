// ISO-16 -- the single production hook that owns the encrypted runtime
// lifecycle. It is the ONLY normal-runtime caller of the migration orchestrator.
//
// It coordinates: build policy -> workspace eligibility -> vault unlocked ->
// migration inspection/resume -> completed-authority seal -> runtime hydration
// -> authoritative facade installation -> mutation status -> revocation.
//
// It exposes only a narrow frozen public shape. Identity, workspace tag,
// namespace, DEK, repository records, manifest contents, runtime catalog
// contents, ciphertext, and IVs are never returned.

import { useCallback, useEffect, useRef, useState } from "react";
import { getVaultBridgeBuildPolicy } from "./vaultBridgeBuildPolicy";
import { readVaultCompatibilityGuard } from "./vaultCompatibilityGuard";
import { createVaultIndexedDbRepository } from "./vaultIndexedDbRepository";
import { createVaultTransitionControlRepository } from "./vaultTransitionControlRepository";
import { migrateActiveWorkspaceVault } from "./vaultMigrationOrchestrator";
import { deriveWorkspaceVaultTag } from "./vaultSession";
import {
  flushVaultRuntime,
  getVaultRuntimeStatus,
  subscribeVaultRuntimeStatus,
  subscribeVaultRuntimeRevalidation,
  hydrateVaultRuntime,
  isVaultRuntimeReady,
  revokeVaultRuntime,
  runtimeClear,
  runtimeGetItem,
  runtimeLogicalKeys,
  runtimeRemoveItem,
  runtimeSetItem,
  sealVaultRuntime,
} from "./vaultRuntimeStore";
import {
  installAuthoritativeVaultRuntime,
  revokeAuthoritativeVaultRuntime,
} from "./accountScopedLocalStorage";

const SAFE_MESSAGE = "";
const DISABLED = Object.freeze({ state: "disabled", checking: false, pending: false, code: "", message: SAFE_MESSAGE });
const CHECKING = Object.freeze({ state: "checking", checking: true, pending: false, code: "", message: SAFE_MESSAGE });

function publicResult(state, code = "", message = SAFE_MESSAGE, pending = false) {
  return Object.freeze({
    state,
    checking: state === "checking" || state === "migrating" || state === "sealing" || state === "hydrating",
    pending,
    code,
    message,
  });
}

const BLOCKED_MESSAGE = "Your encrypted local data could not be opened safely. Nothing was changed or deleted.";
const MIGRATION_MESSAGE = "Encrypting the data already on this device.";
const SEALING_MESSAGE = "Finishing secure setup on this device.";
const HYDRATING_MESSAGE = "Opening your encrypted local data.";

export default function useVaultRuntimeActivation({
  enabled = false,
  userId = "",
  companyId = "",
  vaultUnlocked = false,
} = {}) {
  const [result, setResult] = useState(DISABLED);
  const current = useRef({ generation: 0, mounted: true, identity: "" });
  const identity = enabled && userId && companyId ? `${userId}:${companyId}` : "";

  const revoke = useCallback(() => {
    revokeAuthoritativeVaultRuntime();
    revokeVaultRuntime();
  }, []);

  const activate = useCallback(async (activeIdentity, activeUserId, activeCompanyId) => {
    const generation = ++current.current.generation;
    current.current.identity = activeIdentity;
    // Any previous runtime is revoked BEFORE the new identity does any work, so
    // no cache from the old workspace can ever be visible during the new render.
    revoke();
    setResult(CHECKING);

    const settle = (next) => {
      if (!current.current.mounted || current.current.generation !== generation || current.current.identity !== activeIdentity) {
        return DISABLED;
      }
      setResult(next);
      return next;
    };

    const policy = getVaultBridgeBuildPolicy();
    if (policy.bridgeRelease || !policy.vaultCreationEnabled || !policy.migrationEnabled) {
      return settle(publicResult("blocked", "BUILD_POLICY_INVALID", BLOCKED_MESSAGE));
    }

    let workspaceTag;
    try {
      workspaceTag = await deriveWorkspaceVaultTag(activeUserId, activeCompanyId);
    } catch {
      return settle(publicResult("blocked", "IDENTITY_UNAVAILABLE", BLOCKED_MESSAGE));
    }
    // The tag is the only thing binding this runtime to one workspace. Anything
    // other than an exact tag fails closed here rather than being handed on.
    if (typeof workspaceTag !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(workspaceTag)) {
      return settle(publicResult("blocked", "IDENTITY_UNAVAILABLE", BLOCKED_MESSAGE));
    }
    if (current.current.generation !== generation) return DISABLED;

    // A browser without usable IndexedDB must fail closed with a stable public
    // code, never throw out of activation.
    let vaultRepository;
    try {
      vaultRepository = createVaultIndexedDbRepository();
    } catch {
      return settle(publicResult("blocked", "UNSUPPORTED_ENVIRONMENT", BLOCKED_MESSAGE));
    }

    // 1. Is there already an authoritative runtime for this workspace?
    let catalog = null;
    try {
      catalog = await vaultRepository.readRuntimeCatalog({ workspaceTag });
    } catch (error) {
      if (error?.code !== "DATABASE_NOT_FOUND") {
        return settle(publicResult("blocked", "RUNTIME_UNAVAILABLE", BLOCKED_MESSAGE));
      }
    }
    if (current.current.generation !== generation) return DISABLED;

    // 2. No runtime yet: inspect migration state and resume or run it.
    if (!catalog) {
      const guard = readVaultCompatibilityGuard();
      if (guard.state === "blocked") return settle(publicResult("blocked", "GUARD_UNAVAILABLE", BLOCKED_MESSAGE));

      let transition = null;
      try {
        transition = await createVaultTransitionControlRepository({
          indexedDB: typeof window === "undefined" ? null : window.indexedDB,
          clock: Date.now,
        }).readActiveTransition({});
      } catch {
        return settle(publicResult("blocked", "TRANSITION_UNAVAILABLE", BLOCKED_MESSAGE));
      }
      if (current.current.generation !== generation) return DISABLED;

      if (guard.state !== "authoritative" || transition) {
        // Resume an existing transition, or start the first one. The
        // orchestrator itself refuses to create a second transition and refuses
        // to reinventory after the point of no return.
        settle(publicResult("migrating", "", MIGRATION_MESSAGE));
        const migration = await migrateActiveWorkspaceVault({ userId: activeUserId, companyId: activeCompanyId });
        if (current.current.generation !== generation) return DISABLED;
        if (migration.state !== "authoritative") {
          return settle(publicResult("blocked", migration.code || "MIGRATION_BLOCKED", BLOCKED_MESSAGE));
        }
      }

      // 3. Authority is complete but no runtime catalog exists: seal the
      //    verified encrypted record set into the first catalog. The frozen
      //    migration manifest is read, never rewritten.
      settle(publicResult("sealing", "", SEALING_MESSAGE));
      const sealed = await sealVaultRuntime({ userId: activeUserId, companyId: activeCompanyId, repository: vaultRepository });
      if (current.current.generation !== generation) return DISABLED;
      if (!sealed.ok) return settle(publicResult("blocked", sealed.code || "SEAL_FAILED", BLOCKED_MESSAGE));
    }

    // 4. Hydrate and verify the runtime catalog and every record it names.
    settle(publicResult("hydrating", "", HYDRATING_MESSAGE));
    const hydrated = await hydrateVaultRuntime({ userId: activeUserId, companyId: activeCompanyId, repository: vaultRepository });
    if (current.current.generation !== generation) return DISABLED;
    if (!hydrated.ok) return settle(publicResult("blocked", hydrated.code || "HYDRATION_FAILED", BLOCKED_MESSAGE));

    // 5. Install the authoritative synchronous adapter for this exact workspace
    //    and this exact runtime generation.
    const installed = installAuthoritativeVaultRuntime({
      workspaceTag,
      generation: hydrated.generation,
      adapter: {
        isReady: (adapterGeneration) => isVaultRuntimeReady(adapterGeneration),
        getItem: (logicalKey) => runtimeGetItem(logicalKey),
        setItem: (logicalKey, value) => runtimeSetItem(logicalKey, value),
        removeItem: (logicalKey) => runtimeRemoveItem(logicalKey),
        clear: () => runtimeClear(),
        keys: () => runtimeLogicalKeys(),
      },
    });
    if (!installed) return settle(publicResult("blocked", "ADAPTER_UNAVAILABLE", BLOCKED_MESSAGE));
    if (current.current.generation !== generation) {
      revoke();
      return DISABLED;
    }
    return settle(publicResult("ready"));
  }, [revoke]);

  useEffect(() => {
    const inspection = current.current;
    inspection.mounted = true;
    return () => {
      inspection.mounted = false;
      inspection.generation += 1;
      inspection.identity = "";
      revoke();
    };
  }, [revoke]);

  useEffect(() => {
    if (!identity || !vaultUnlocked) {
      current.current.generation += 1;
      current.current.identity = "";
      revoke();
      setResult(DISABLED);
      return undefined;
    }
    activate(identity, userId, companyId);
    return undefined;
  }, [identity, vaultUnlocked, userId, companyId, activate, revoke]);

  // Durability is tracked honestly: a queued-but-uncommitted write reports
  // `pending-writes`, and the first durability failure reports `blocked`.
  //
  // This is a subscription, not a poll: a timer would keep an open handle alive
  // for the lifetime of every mounted app.
  useEffect(() => {
    const apply = (status) => {
      setResult((previous) => {
        if (previous.state !== "ready" && previous.state !== "pending-writes") return previous;
        if (status.state === "blocked") return publicResult("blocked", status.code || "DURABILITY_FAILED", BLOCKED_MESSAGE);
        if (status.state === "pending-writes") return previous.state === "pending-writes" ? previous : publicResult("pending-writes", "", SAFE_MESSAGE, true);
        if (status.state === "ready") return previous.state === "ready" ? previous : publicResult("ready");
        return previous;
      });
    };
    return subscribeVaultRuntimeStatus(apply);
  }, []);

  // Another tab committed a newer catalog (or this tab regained focus): re-read
  // and re-verify rather than trusting a possibly stale cache.
  useEffect(() => {
    if (!identity || !vaultUnlocked) return undefined;
    return subscribeVaultRuntimeRevalidation(() => {
      if (current.current.identity === identity) activate(identity, userId, companyId);
    });
  }, [identity, vaultUnlocked, userId, companyId, activate]);

  const refresh = useCallback(() => {
    if (!identity || !vaultUnlocked) return Promise.resolve(DISABLED);
    return activate(identity, userId, companyId);
  }, [activate, identity, userId, companyId, vaultUnlocked]);

  // Bounded flush before a deliberate lock. A failed flush never claims a clean
  // lock: the runtime stays blocked and the shell stays unmounted.
  const flushAndLock = useCallback(async (lock) => {
    const status = await flushVaultRuntime();
    if (status.state === "blocked") {
      setResult(publicResult("blocked", status.code || "DURABILITY_FAILED", BLOCKED_MESSAGE));
      return Object.freeze({ ok: false, code: status.code || "DURABILITY_FAILED" });
    }
    revoke();
    if (typeof lock === "function") lock();
    setResult(DISABLED);
    return Object.freeze({ ok: true, code: "" });
  }, [revoke]);

  return Object.freeze({
    state: result.state,
    checking: result.checking,
    pending: result.pending,
    code: result.code,
    message: result.message,
    refresh,
    flushAndLock,
  });
}
