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
  beginVaultRuntimeActivation,
  flushVaultRuntime,
  freezeVaultRuntimeMutations,
  hasVaultRuntimeSession,
  unfreezeVaultRuntimeMutations,
  subscribeVaultRuntimeStatus,
  subscribeVaultRuntimeRevalidation,
  hydrateVaultRuntime,
  isVaultRuntimeReadable,
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

const WORKSPACE_TAG = /^[A-Za-z0-9_-]{43}$/;

// ---------------------------------------------------------------------------
// Activation state matrix
//
// Review finding: the previous order read the runtime catalog FIRST and only
// looked at the guard and the transition record when no catalog existed. That
// made a catalog the sole proof of authority -- a catalog present next to a
// non-authoritative guard, or next to a live transition record, was hydrated
// without comment. Every input is now always inspected and every combination
// has one explicit, enumerated outcome. Anything not enumerated fails closed.
// ---------------------------------------------------------------------------

export const VAULT_ACTIVATION_PLAN_ACTIONS = Object.freeze({
  MIGRATE: "migrate",
  SEAL: "seal",
  HYDRATE: "hydrate",
  BLOCK: "block",
});

export const VAULT_ACTIVATION_PLAN_CODES = Object.freeze({
  BUILD_POLICY_INVALID: "BUILD_POLICY_INVALID",
  GUARD_UNAVAILABLE: "GUARD_UNAVAILABLE",
  GUARD_RECOVERY_REQUIRED: "GUARD_RECOVERY_REQUIRED",
  OTHER_WORKSPACE_TRANSITION: "OTHER_WORKSPACE_TRANSITION",
  RUNTIME_GUARD_MISMATCH: "RUNTIME_GUARD_MISMATCH",
  RUNTIME_TRANSITION_CONFLICT: "RUNTIME_TRANSITION_CONFLICT",
});

const GUARD_STATES = Object.freeze(["absent", "transition", "authoritative"]);

/**
 * Pure, exhaustive activation decision. Every case is enumerated:
 *
 *   A  policy invalid, any input                     -> block BUILD_POLICY_INVALID
 *   B  guard unreadable / blocked / unknown          -> block GUARD_UNAVAILABLE
 *   C  transition belongs to another workspace       -> block OTHER_WORKSPACE_TRANSITION
 *   D  catalog present, guard not authoritative      -> block RUNTIME_GUARD_MISMATCH
 *   E  catalog present, transition still active      -> block RUNTIME_TRANSITION_CONFLICT
 *   F  catalog present, guard authoritative, no txn  -> hydrate
 *   G  no catalog, transition active                 -> migrate (resume)
 *   H  no catalog, guard absent, no transition       -> migrate (first run)
 *   I  no catalog, guard transition, no transition   -> block GUARD_RECOVERY_REQUIRED
 *   J  no catalog, guard authoritative, no txn       -> seal
 */
export function resolveVaultActivationPlan({ policy, guard, transition, catalogPresent, workspaceTag } = {}) {
  const block = (code) => Object.freeze({ action: VAULT_ACTIVATION_PLAN_ACTIONS.BLOCK, code, case: "" });
  const plan = (action, planCase) => Object.freeze({ action, code: "", case: planCase });

  // A -- the release policy is checked on every activation, not only on the
  // paths that create a vault.
  if (!policy || typeof policy !== "object"
    || policy.bridgeRelease !== false
    || policy.vaultCreationEnabled !== true
    || policy.migrationEnabled !== true) {
    return Object.freeze({ ...block(VAULT_ACTIVATION_PLAN_CODES.BUILD_POLICY_INVALID), case: "A" });
  }

  // B -- an unreadable, blocked, or unrecognized guard is never interpreted.
  if (!guard || typeof guard !== "object" || !GUARD_STATES.includes(guard.state)) {
    return Object.freeze({ ...block(VAULT_ACTIVATION_PLAN_CODES.GUARD_UNAVAILABLE), case: "B" });
  }

  const hasTransition = Boolean(transition);
  // C -- a transition owned by a different workspace is never resumed, never
  // ignored, and never hydrated past.
  if (hasTransition && (!WORKSPACE_TAG.test(workspaceTag || "") || transition.workspaceTag !== workspaceTag)) {
    return Object.freeze({ ...block(VAULT_ACTIVATION_PLAN_CODES.OTHER_WORKSPACE_TRANSITION), case: "C" });
  }

  if (catalogPresent) {
    // D -- a runtime catalog can only exist for a workspace whose guard already
    // claims authority. Anything else is inconsistent local state.
    if (guard.state !== "authoritative") {
      return Object.freeze({ ...block(VAULT_ACTIVATION_PLAN_CODES.RUNTIME_GUARD_MISMATCH), case: "D" });
    }
    // E -- an active transition alongside an existing runtime means an
    // interrupted or concurrent migration; hydrating over it could publish a
    // cache that a resuming migration is about to invalidate.
    if (hasTransition) {
      return Object.freeze({ ...block(VAULT_ACTIVATION_PLAN_CODES.RUNTIME_TRANSITION_CONFLICT), case: "E" });
    }
    return plan(VAULT_ACTIVATION_PLAN_ACTIONS.HYDRATE, "F");                     // F
  }

  if (hasTransition) return plan(VAULT_ACTIVATION_PLAN_ACTIONS.MIGRATE, "G");    // G
  if (guard.state === "absent") return plan(VAULT_ACTIVATION_PLAN_ACTIONS.MIGRATE, "H"); // H
  // I -- the guard says a transition is in progress but no transition record
  // exists. The orchestrator refuses this too; it is surfaced here explicitly.
  if (guard.state === "transition") {
    return Object.freeze({ ...block(VAULT_ACTIVATION_PLAN_CODES.GUARD_RECOVERY_REQUIRED), case: "I" });
  }
  return plan(VAULT_ACTIVATION_PLAN_ACTIONS.SEAL, "J");                          // J
}

export default function useVaultRuntimeActivation({
  enabled = false,
  userId = "",
  companyId = "",
  vaultUnlocked = false,
} = {}) {
  const [result, setResult] = useState(DISABLED);
  const current = useRef({ generation: 0, mounted: true, identity: "" });
  // Revalidation is serialized and coalesced: overlapping signals from several
  // tabs must never run two hydrations against the same identity at once.
  const revalidation = useRef({ running: false, queued: false });
  const identity = enabled && userId && companyId ? `${userId}:${companyId}` : "";

  const revoke = useCallback(() => {
    revokeAuthoritativeVaultRuntime();
    revokeVaultRuntime();
  }, []);

  const installAdapter = useCallback((workspaceTag, generation) => installAuthoritativeVaultRuntime({
    workspaceTag,
    generation,
    adapter: {
      // canRead stays true while mutations are frozen: the last VERIFIED cache
      // is still the only correct answer for an approved key, and falling back
      // to scoped plaintext is exactly what must never happen.
      canRead: (adapterGeneration) => isVaultRuntimeReadable(adapterGeneration),
      canMutate: (adapterGeneration) => isVaultRuntimeReady(adapterGeneration),
      isReady: (adapterGeneration) => isVaultRuntimeReady(adapterGeneration),
      getItem: (logicalKey) => runtimeGetItem(logicalKey),
      setItem: (logicalKey, value) => runtimeSetItem(logicalKey, value),
      removeItem: (logicalKey) => runtimeRemoveItem(logicalKey),
      clear: () => runtimeClear(),
      keys: () => runtimeLogicalKeys(),
    },
  }), []);

  // -------------------------------------------------------------------------
  // Initial activation / identity replacement.
  //
  // This path OWNS revocation: the previous workspace's cache must be gone
  // before the new identity does any work. Same-identity refreshes go through
  // `revalidate` instead, which never tears down a healthy runtime.
  // -------------------------------------------------------------------------
  const runActivation = useCallback(async (activeIdentity, activeUserId, activeCompanyId, owner = null) => {
    const generation = ++current.current.generation;
    current.current.identity = activeIdentity;
    // This operation now owns exactly this identity and generation.
    if (owner) { owner.identity = activeIdentity; owner.generation = generation; }
    revoke();
    // Claim the next runtime session. A completion after lock, unmount, or a
    // newer activation can no longer recreate a runtime behind the gate.
    const activationToken = beginVaultRuntimeActivation();
    setResult(CHECKING);

    const stale = () => !current.current.mounted
      || current.current.generation !== generation
      || current.current.identity !== activeIdentity;

    const settle = (next) => {
      if (stale()) return DISABLED;
      setResult(next);
      return next;
    };

    let workspaceTag;
    try {
      workspaceTag = await deriveWorkspaceVaultTag(activeUserId, activeCompanyId);
    } catch {
      return settle(publicResult("blocked", "IDENTITY_UNAVAILABLE", BLOCKED_MESSAGE));
    }
    // The tag is the only thing binding this runtime to one workspace. Anything
    // other than an exact tag fails closed here rather than being handed on.
    if (typeof workspaceTag !== "string" || !WORKSPACE_TAG.test(workspaceTag)) {
      return settle(publicResult("blocked", "IDENTITY_UNAVAILABLE", BLOCKED_MESSAGE));
    }
    if (stale()) return DISABLED;

    // A browser without usable IndexedDB must fail closed with a stable public
    // code, never throw out of activation.
    let vaultRepository;
    try {
      vaultRepository = createVaultIndexedDbRepository();
    } catch {
      return settle(publicResult("blocked", "UNSUPPORTED_ENVIRONMENT", BLOCKED_MESSAGE));
    }

    // 1. Inspect EVERY input before deciding anything: build policy, the
    //    compatibility guard, the transition-control record, and the runtime
    //    catalog. None of them alone is proof of authority.
    const policy = getVaultBridgeBuildPolicy();

    let guard = null;
    try {
      guard = readVaultCompatibilityGuard();
    } catch {
      guard = null;
    }

    let transition = null;
    try {
      transition = await createVaultTransitionControlRepository({
        indexedDB: typeof window === "undefined" ? null : window.indexedDB,
        clock: Date.now,
      }).readActiveTransition({});
    } catch {
      return settle(publicResult("blocked", "TRANSITION_UNAVAILABLE", BLOCKED_MESSAGE));
    }
    if (stale()) return DISABLED;

    let catalog = null;
    try {
      catalog = await vaultRepository.readRuntimeCatalog({ workspaceTag });
    } catch (error) {
      if (error?.code !== "DATABASE_NOT_FOUND") {
        return settle(publicResult("blocked", "RUNTIME_UNAVAILABLE", BLOCKED_MESSAGE));
      }
    }
    if (stale()) return DISABLED;

    // 2. One exhaustive decision over the complete state.
    const plan = resolveVaultActivationPlan({
      policy, guard, transition, catalogPresent: Boolean(catalog), workspaceTag,
    });
    if (plan.action === VAULT_ACTIVATION_PLAN_ACTIONS.BLOCK) {
      return settle(publicResult("blocked", plan.code, BLOCKED_MESSAGE));
    }

    if (plan.action === VAULT_ACTIVATION_PLAN_ACTIONS.MIGRATE) {
      // Resume an existing transition, or start the first one. The orchestrator
      // itself refuses to create a second transition and refuses to reinventory
      // after the point of no return.
      settle(publicResult("migrating", "", MIGRATION_MESSAGE));
      const migration = await migrateActiveWorkspaceVault({ userId: activeUserId, companyId: activeCompanyId });
      if (stale()) return DISABLED;
      if (migration.state !== "authoritative") {
        return settle(publicResult("blocked", migration.code || "MIGRATION_BLOCKED", BLOCKED_MESSAGE));
      }
    }

    if (plan.action === VAULT_ACTIVATION_PLAN_ACTIONS.MIGRATE || plan.action === VAULT_ACTIVATION_PLAN_ACTIONS.SEAL) {
      // 3. Authority is complete but no runtime catalog exists: seal the
      //    verified completed migration into the first catalog. The frozen
      //    migration manifest is read, never rewritten.
      settle(publicResult("sealing", "", SEALING_MESSAGE));
      const sealed = await sealVaultRuntime({ userId: activeUserId, companyId: activeCompanyId, repository: vaultRepository });
      if (stale()) return DISABLED;
      if (!sealed.ok) return settle(publicResult("blocked", sealed.code || "SEAL_FAILED", BLOCKED_MESSAGE));
    }

    // 4. Hydrate and verify the runtime catalog and every record it names.
    settle(publicResult("hydrating", "", HYDRATING_MESSAGE));
    const hydrated = await hydrateVaultRuntime({
      userId: activeUserId, companyId: activeCompanyId, repository: vaultRepository, activation: activationToken,
    });
    if (stale()) return DISABLED;
    // A stale candidate changed nothing and must not be reported as a failure.
    if (hydrated.state === "stale") return DISABLED;
    if (!hydrated.ok) return settle(publicResult("blocked", hydrated.code || "HYDRATION_FAILED", BLOCKED_MESSAGE));

    // 5. Install the authoritative synchronous adapter for this exact workspace
    //    and this exact runtime generation.
    if (!installAdapter(workspaceTag, hydrated.generation)) {
      return settle(publicResult("blocked", "ADAPTER_UNAVAILABLE", BLOCKED_MESSAGE));
    }
    if (stale()) {
      revoke();
      return DISABLED;
    }
    return settle(publicResult("ready"));
  }, [revoke, installAdapter]);

  // -------------------------------------------------------------------------
  // Same-identity revalidation.
  //
  // Review finding: this used to call the full activation path, which revoked
  // the runtime immediately -- so a message from another tab tore down a
  // perfectly healthy local runtime and discarded queued writes before they
  // were durable. Revalidation now flushes first, re-hydrates in place, and
  // only replaces the cache once the new state verifies.
  // -------------------------------------------------------------------------
  const revalidate = useCallback(async (activeIdentity, activeUserId, activeCompanyId, owner = null) => {
    if (current.current.identity !== activeIdentity) return DISABLED;
    if (owner) { owner.identity = activeIdentity; owner.generation = current.current.generation; }
    if (revalidation.current.running) {
      // Coalesce: one more pass runs after the in-flight one, so a burst of
      // cross-tab messages (N+1 then N+2 then N+3) produces at most one extra
      // pass and never two overlapping hydrations.
      revalidation.current.queued = true;
      return DISABLED;
    }
    revalidation.current.running = true;
    let outcome = DISABLED;
    // Held in a const box so the per-pass helpers below can flip it without
    // closing over a reassigned loop variable.
    const pass = { frozen: false, lease: null };
    try {
      do {
        revalidation.current.queued = false;
        const generation = current.current.generation;
        if (owner) owner.generation = generation;
        const stale = () => !current.current.mounted
          || current.current.generation !== generation
          || current.current.identity !== activeIdentity;
        const fail = (code) => {
          pass.frozen = false;
          pass.lease = null;
          revoke();
          const blocked = publicResult("blocked", code, BLOCKED_MESSAGE);
          setResult(blocked);
          return blocked;
        };

        let workspaceTag;
        try {
          workspaceTag = await deriveWorkspaceVaultTag(activeUserId, activeCompanyId);
        } catch {
          workspaceTag = "";
        }
        if (stale()) return DISABLED;
        if (!WORKSPACE_TAG.test(workspaceTag || "")) return fail("IDENTITY_UNAVAILABLE");

        // 1. Queued local mutations must reach durability BEFORE anything is
        //    replaced, otherwise re-hydration would silently discard them.
        const flushed = await flushVaultRuntime();
        if (stale()) return DISABLED;
        if (flushed.state === "blocked") {
          // A conflict means another tab already committed over this tab's
          // expected revision. That is a hard block, never a silent overwrite.
          return fail(flushed.code || "DURABILITY_FAILED");
        }

        // 2. Freeze new mutations and publish a checking state, so App puts the
        //    shell behind VaultRuntimeGate and cloud workers lose their identity
        //    for the duration. Reads keep serving the last VERIFIED cache; new
        //    approved writes get a definite refusal rather than being accepted
        //    into a session that is about to be replaced.
        const frozen = freezeVaultRuntimeMutations();
        pass.frozen = frozen.frozen;
        pass.lease = frozen.lease;
        if (!stale()) setResult(publicResult("hydrating", "", HYDRATING_MESSAGE));

        // 3. Verify a candidate. hydrateVaultRuntime keeps the previous verified
        //    runtime active throughout and swaps atomically only on success.
        const hydrated = await hydrateVaultRuntime({
          userId: activeUserId, companyId: activeCompanyId, lease: pass.lease,
        });
        if (stale()) return DISABLED;
        // The lease no longer owns the active session: the runtime was locked,
        // revoked, or replaced while this candidate was verifying. It published
        // nothing, so this pass simply stands down.
        if (hydrated.state === "stale") {
          pass.frozen = false;
          pass.lease = null;
          // This pass published a gated state before it lost ownership, so it
          // must not leave the hook stuck in `hydrating`. It reports what the
          // CURRENT owner is, without touching the runtime: ready if a healthy
          // session exists, otherwise disabled for whoever owns it next.
          const settled = isVaultRuntimeReady() ? publicResult("ready") : DISABLED;
          if (current.current.mounted && current.current.identity === activeIdentity) setResult(settled);
          return settled;
        }
        if (!hydrated.ok) return fail(hydrated.code || "HYDRATION_FAILED");

        // 4. The replacement already happened inside hydration; bind the adapter
        //    to the new generation and reopen mutations.
        if (!installAdapter(workspaceTag, hydrated.generation)) return fail("ADAPTER_UNAVAILABLE");
        // The replacement cleared the freeze with the session it retired.
        pass.frozen = false;
        pass.lease = null;
        if (stale()) {
          revoke();
          return DISABLED;
        }
        outcome = publicResult("ready");
        setResult(outcome);
      } while (revalidation.current.queued);
    } finally {
      // A revalidation that ends without replacing the runtime must never leave
      // mutations frozen.
      // Only the exact lease may reopen mutations; a stale one changes nothing.
      if (pass.frozen && pass.lease) unfreezeVaultRuntimeMutations(pass.lease);
      revalidation.current.running = false;
      revalidation.current.queued = false;
    }
    return outcome;
  }, [revoke, installAdapter]);

  // -------------------------------------------------------------------------
  // Fail-closed exception boundary.
  //
  // Review finding: an unexpected throw anywhere in the async lifecycle escaped
  // as an unhandled rejection, leaving the hook stuck in `checking` with no
  // published state. Every lifecycle entry point now terminates in one place:
  // the runtime is revoked and the hook reports `blocked`.
  // -------------------------------------------------------------------------
  const guarded = useCallback(async (run) => {
    // Ownership snapshot. The operation fills it in once it knows which identity
    // and activation generation it belongs to, so a late rejection from a
    // SUPERSEDED operation can never revoke or block the identity that replaced
    // it. A stale owner returns disabled and changes nothing.
    const owner = { identity: current.current.identity, generation: current.current.generation };
    try {
      return await run(owner);
    } catch {
      const stale = !current.current.mounted
        || current.current.identity !== owner.identity
        || current.current.generation !== owner.generation;
      if (stale) return DISABLED;
      revoke();
      const blocked = publicResult("blocked", "ACTIVATION_FAILED", BLOCKED_MESSAGE);
      setResult(blocked);
      return blocked;
    }
  }, [revoke]);

  const activate = useCallback((activeIdentity, activeUserId, activeCompanyId) => guarded(
    (owner) => runActivation(activeIdentity, activeUserId, activeCompanyId, owner),
  ), [guarded, runActivation]);

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

  // Durability remains visible without revoking application access: queued
  // encrypted writes keep the runtime in the public `ready` state and set the
  // separate `pending` flag. Only an actual durability failure blocks the shell.
  useEffect(() => {
    const apply = (status) => {
      setResult((previous) => {
        // Normalize a legacy in-memory `pending-writes` result if this module is
        // replaced during development without a full page reload.
        if (previous.state !== "ready" && previous.state !== "pending-writes") return previous;
        if (status.state === "blocked") return publicResult("blocked", status.code || "DURABILITY_FAILED", BLOCKED_MESSAGE);
        if (status.state === "pending-writes") {
          return previous.state === "ready" && previous.pending
            ? previous
            : publicResult("ready", "", SAFE_MESSAGE, true);
        }
        if (status.state === "ready") {
          return previous.state === "ready" && !previous.pending
            ? previous
            : publicResult("ready");
        }
        return previous;
      });
    };
    return subscribeVaultRuntimeStatus(apply);
  }, []);

  // Another tab committed a newer catalog (or this tab regained focus): re-read
  // and re-verify in place rather than trusting a possibly stale cache.
  useEffect(() => {
    if (!identity || !vaultUnlocked) return undefined;
    return subscribeVaultRuntimeRevalidation(() => {
      if (current.current.identity !== identity) return;
      guarded((owner) => revalidate(identity, userId, companyId, owner));
    });
  }, [identity, vaultUnlocked, userId, companyId, guarded, revalidate]);

  // A manual refresh of the SAME identity is a revalidation, not a re-activation:
  // it must flush accepted writes, freeze, gate the shell, verify a candidate and
  // swap atomically. Running the destructive activation path here revoked the
  // runtime before the flush and could lose an accepted write.
  const refresh = useCallback(() => {
    if (!identity || !vaultUnlocked) return Promise.resolve(DISABLED);
    // A FROZEN runtime deliberately reports not-ready, so readiness must never
    // be the test for "does this identity own a session". Using it meant a
    // second refresh during a revalidation fell into the destructive activation
    // path instead of coalescing.
    if (current.current.identity === identity
      && (revalidation.current.running || hasVaultRuntimeSession())) {
      return guarded((owner) => revalidate(identity, userId, companyId, owner));
    }
    return activate(identity, userId, companyId);
  }, [activate, guarded, revalidate, identity, userId, companyId, vaultUnlocked]);

  // Bounded flush before a deliberate lock. A failed flush never claims a clean
  // lock: the runtime stays blocked and the shell stays unmounted.
  const flushAndLock = useCallback(async (lock) => guarded(async () => {
    const status = await flushVaultRuntime();
    if (status.state === "blocked") {
      setResult(publicResult("blocked", status.code || "DURABILITY_FAILED", BLOCKED_MESSAGE));
      return Object.freeze({ ok: false, code: status.code || "DURABILITY_FAILED" });
    }
    revoke();
    if (typeof lock === "function") lock();
    setResult(DISABLED);
    return Object.freeze({ ok: true, code: "" });
  }).then((value) => (value && value.ok !== undefined
    ? value
    : Object.freeze({ ok: false, code: value?.code || "ACTIVATION_FAILED" }))),
  [guarded, revoke]);

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
