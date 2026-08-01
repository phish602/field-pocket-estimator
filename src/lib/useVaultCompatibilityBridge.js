import { useCallback, useEffect, useRef, useState } from "react";
import { createVaultIndexedDbRepository, VAULT_REPOSITORY_ERROR_CODES } from "./vaultIndexedDbRepository";
import { createVaultTransitionControlRepository } from "./vaultTransitionControlRepository";
import { readVaultCompatibilityGuard, VAULT_COMPATIBILITY_GUARD_KEY } from "./vaultCompatibilityGuard";
import { getVaultBridgeBuildPolicy } from "./vaultBridgeBuildPolicy";
import {
  isActiveAccountScopedNativeStorage,
  setActiveWorkspaceVaultCompatibility,
} from "./accountScopedLocalStorage";

const SAFE_MESSAGE = "";
const DISABLED = Object.freeze({ state: "disabled", checking: false, code: "", message: SAFE_MESSAGE });
const CHECKING = Object.freeze({ state: "checking", checking: true, code: "", message: SAFE_MESSAGE });

function publicResult(state, code = "", message = SAFE_MESSAGE) {
  return Object.freeze({ state, checking: state === "checking", code, message });
}

function blockedForGuard(guard) {
  return guard?.code === "STORAGE_UNAVAILABLE"
    ? publicResult("storage-blocked", "STORAGE_UNAVAILABLE", "Secure local storage is unavailable.")
    : publicResult("corrupt-blocked", "GUARD_INVALID", "Secure local data access could not be verified.");
}

function canInspect(enabled, workspaceTag) {
  return Boolean(enabled && typeof workspaceTag === "string" && workspaceTag);
}

async function readBridgeMigrationManifest(vaultRepository, workspaceTag) {
  try {
    return await vaultRepository.readMigrationManifest({ workspaceTag });
  } catch (error) {
    if (error?.code === VAULT_REPOSITORY_ERROR_CODES.DATABASE_NOT_FOUND) return null;
    throw error;
  }
}

export default function useVaultCompatibilityBridge({ enabled = false, workspaceTag = "" } = {}) {
  const [result, setResult] = useState(DISABLED);
  const current = useRef({ generation: 0, mounted: true, workspaceTag: "" });

  const revoke = useCallback((tag = "") => {
    setActiveWorkspaceVaultCompatibility({ workspaceTag: tag, state: "checking", generation: current.current.generation });
  }, []);

  const inspect = useCallback((tag) => {
    const generation = ++current.current.generation;
    current.current.workspaceTag = tag;
    revoke(tag);
    setResult(CHECKING);

    return Promise.resolve().then(async () => {
      const guard = readVaultCompatibilityGuard();
      if (guard.state === "blocked") return blockedForGuard(guard);

      let transition;
      let manifest;
      try {
        const transitionRepository = createVaultTransitionControlRepository({
          indexedDB: typeof window === "undefined" ? null : window.indexedDB,
          clock: () => Date.now(),
        });
        const vaultRepository = createVaultIndexedDbRepository();
        [transition, manifest] = await Promise.all([
          transitionRepository.readActiveTransition({}),
          readBridgeMigrationManifest(vaultRepository, tag),
        ]);
      } catch {
        return publicResult("storage-blocked", "STORAGE_UNAVAILABLE", "Secure local storage is unavailable.");
      }

      const policy = getVaultBridgeBuildPolicy();
      if (!policy.bridgeRelease || policy.migrationEnabled || policy.vaultCreationEnabled) {
        return publicResult("corrupt-blocked", "BUILD_POLICY_INVALID", "Secure local data access could not be verified.");
      }
      if (guard.state === "authoritative") {
        return publicResult("authoritative-blocked", "AUTHORITATIVE_GUARD", "Secure local data is in its authoritative vault state.");
      }
      if (guard.state === "transition") {
        if (!transition) return publicResult("corrupt-blocked", "TRANSITION_MISSING", "Secure local data access could not be verified.");
        return transition.workspaceTag === tag
          ? publicResult("transition-blocked", "TRANSITION_ACTIVE", "A secure local-data transition is in progress.")
          : publicResult("other-workspace-transition", "OTHER_WORKSPACE_TRANSITION", "Another local workspace transition is pending.");
      }
      if (transition) {
        return transition.workspaceTag === tag
          ? publicResult("transition-blocked", "TRANSITION_ACTIVE", "A secure local-data transition is in progress.")
          : publicResult("other-workspace-transition", "OTHER_WORKSPACE_TRANSITION", "Another local workspace transition is pending.");
      }
      if (manifest !== null) return publicResult("corrupt-blocked", "MANIFEST_PRESENT", "Secure local data access could not be verified.");
      return publicResult("legacy-safe");
    }).then((next) => {
      if (!current.current.mounted || current.current.generation !== generation || current.current.workspaceTag !== tag) return DISABLED;
      setResult(next);
      setActiveWorkspaceVaultCompatibility({ workspaceTag: tag, state: next.state, generation });
      return next;
    }).catch(() => {
      const next = publicResult("storage-blocked", "STORAGE_UNAVAILABLE", "Secure local storage is unavailable.");
      if (!current.current.mounted || current.current.generation !== generation || current.current.workspaceTag !== tag) return DISABLED;
      setResult(next);
      setActiveWorkspaceVaultCompatibility({ workspaceTag: tag, state: next.state, generation });
      return next;
    });
  }, [revoke]);

  useEffect(() => {
    const inspection = current.current;
    inspection.mounted = true;
    return () => {
      inspection.mounted = false;
      inspection.generation += 1;
      inspection.workspaceTag = "";
      revoke();
    };
  }, [revoke]);

  useEffect(() => {
    if (!canInspect(enabled, workspaceTag)) {
      current.current.generation += 1;
      current.current.workspaceTag = "";
      revoke();
      setResult(DISABLED);
      return undefined;
    }
    inspect(workspaceTag);
    return undefined;
  }, [enabled, inspect, revoke, workspaceTag]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.addEventListener !== "function") return undefined;
    const listener = (event) => {
      const currentTag = current.current.workspaceTag;
      let matchesStorage = false;
      try {
        matchesStorage = event?.storageArea === window.localStorage || isActiveAccountScopedNativeStorage(event?.storageArea);
      } catch {
        matchesStorage = false;
      }
      if (!matchesStorage || event?.key !== VAULT_COMPATIBILITY_GUARD_KEY || !currentTag) return;
      current.current.generation += 1;
      revoke(currentTag);
      setResult(CHECKING);
      inspect(currentTag);
    };
    window.addEventListener("storage", listener);
    return () => window.removeEventListener("storage", listener);
  }, [inspect, revoke]);

  const refresh = useCallback(() => {
    if (!canInspect(enabled, workspaceTag)) {
      revoke();
      return Promise.resolve(DISABLED);
    }
    return inspect(workspaceTag);
  }, [enabled, inspect, revoke, workspaceTag]);

  return Object.freeze({
    state: result.state,
    checking: result.checking,
    code: result.code,
    message: result.message,
    refresh,
  });
}
