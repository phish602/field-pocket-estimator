import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  lockVault,
  readVaultCapability,
  setupVault,
  unlockVault,
} from "./vaultSession";

const LOCKED_CAPABILITY = Object.freeze({ state: "locked", code: "", message: "" });
const SAFE_STORAGE_CODE = "STORAGE_OPERATION_FAILED";
const PUBLIC_CODES = new Set([
  "AUTHENTICATION_FAILED",
  "RECORD_CORRUPT",
  "UNSUPPORTED_ENVIRONMENT",
  "UNSUPPORTED_KDF_POLICY",
  "DATABASE_BLOCKED",
  "QUOTA_EXCEEDED",
  "TRANSACTION_ABORTED",
  SAFE_STORAGE_CODE,
]);

function workspaceIdentity({ userId, companyId, enabled }) {
  const normalizedUserId = String(userId || "").trim();
  const normalizedCompanyId = String(companyId || "").trim();
  return enabled && normalizedUserId && normalizedCompanyId
    ? `${normalizedUserId}|${normalizedCompanyId}`
    : "";
}

function publicCapability(value) {
  const state = String(value?.state || "locked");
  const suppliedCode = String(value?.code || "");
  const code = PUBLIC_CODES.has(suppliedCode) ? suppliedCode : "";
  // The headless runtime only returns public capability data. Copy exactly
  // that small surface instead of retaining an object returned by a crypto or
  // repository operation.
  if (code === "AUTHENTICATION_FAILED") {
    return { state: "locked", code, message: "The Local Data Password is incorrect or the local vault is damaged." };
  }
  if (state === "damaged") return { state, code, message: "The local vault is damaged." };
  if (state === "unsupported") return { state, code, message: "Secure local vault support is unavailable." };
  if (code) return { state, code, message: "Vault storage operation failed." };
  return { state, code: "", message: "" };
}

function failedCapability() {
  return { state: "locked", code: SAFE_STORAGE_CODE, message: "Vault storage operation failed." };
}

export default function useVaultSession({ userId, companyId, enabled = false } = {}) {
  const identity = useMemo(
    () => workspaceIdentity({ userId, companyId, enabled }),
    [companyId, enabled, userId]
  );
  const [result, setResult] = useState({
    capability: LOCKED_CAPABILITY,
    checking: false,
    pending: false,
    error: "",
  });
  const currentRef = useRef({ identity: "", generation: 0, mounted: true });
  const resolvedIdentityRef = useRef("");
  const pendingRef = useRef(false);

  const inspect = useCallback((nextIdentity) => {
    const [nextUserId, nextCompanyId] = nextIdentity.split("|");
    const generation = ++currentRef.current.generation;
    currentRef.current.identity = nextIdentity;
    resolvedIdentityRef.current = "";
    setResult({ capability: LOCKED_CAPABILITY, checking: true, pending: false, error: "" });

    return Promise.resolve(readVaultCapability({ userId: nextUserId, companyId: nextCompanyId }))
      .then((capability) => {
        if (!currentRef.current.mounted
          || currentRef.current.generation !== generation
          || currentRef.current.identity !== nextIdentity) return LOCKED_CAPABILITY;
        resolvedIdentityRef.current = nextIdentity;
        const safeCapability = publicCapability(capability);
        setResult({ capability: safeCapability, checking: false, pending: false, error: "" });
        return safeCapability;
      })
      .catch(() => {
        if (!currentRef.current.mounted
          || currentRef.current.generation !== generation
          || currentRef.current.identity !== nextIdentity) return LOCKED_CAPABILITY;
        resolvedIdentityRef.current = nextIdentity;
        setResult({ capability: failedCapability(), checking: false, pending: false, error: SAFE_STORAGE_CODE });
        return failedCapability();
      });
  }, []);

  useEffect(() => {
    const current = currentRef.current;
    current.mounted = true;
    return () => {
      current.mounted = false;
      current.generation += 1;
      current.identity = "";
      resolvedIdentityRef.current = "";
      pendingRef.current = false;
      lockVault();
    };
  }, []);

  useEffect(() => {
    if (!identity) {
      currentRef.current.generation += 1;
      currentRef.current.identity = "";
      resolvedIdentityRef.current = "";
      pendingRef.current = false;
      // Lock synchronously when workspace access is withdrawn. This leaves no
      // render in which a prior workspace can keep an unlocked shell alive.
      lockVault();
      setResult({ capability: LOCKED_CAPABILITY, checking: false, pending: false, error: "" });
      return undefined;
    }

    // Identity changes invalidate the in-memory DEK before the next workspace
    // is inspected. This is deliberately synchronous and idempotent.
    lockVault();
    inspect(identity);
    return undefined;
  }, [identity, inspect]);

  const refresh = useCallback(() => {
    if (!identity) {
      lockVault();
      return Promise.resolve(LOCKED_CAPABILITY);
    }
    return inspect(identity);
  }, [identity, inspect]);

  const runPasswordOperation = useCallback(async (operation, password) => {
    const startingIdentity = currentRef.current.identity;
    const startingGeneration = currentRef.current.generation;
    if (!startingIdentity || startingIdentity !== identity || pendingRef.current) return LOCKED_CAPABILITY;

    const [activeUserId, activeCompanyId] = startingIdentity.split("|");
    pendingRef.current = true;
    setResult((previous) => ({
      capability: { ...previous.capability, state: "unlocking" },
      checking: false,
      pending: true,
      error: "",
    }));

    let capability;
    try {
      // `password` is a submit-local argument. The hook never stores it in
      // state, context, a ref, or any returned value.
      capability = await operation({ userId: activeUserId, companyId: activeCompanyId, password });
    } catch {
      capability = failedCapability();
    }

    pendingRef.current = false;
    const current = currentRef.current;
    if (!current.mounted
      || current.generation !== startingGeneration
      || current.identity !== startingIdentity
      || startingIdentity !== identity) {
      // A stale successful setup/unlock may have installed a DEK in the
      // headless singleton. Drop it before any later identity can proceed.
      lockVault();
      if (current.mounted && current.identity) inspect(current.identity);
      return LOCKED_CAPABILITY;
    }

    const safeCapability = publicCapability(capability);
    resolvedIdentityRef.current = startingIdentity;
    setResult({ capability: safeCapability, checking: false, pending: false, error: "" });
    return safeCapability;
  }, [identity, inspect]);

  const setup = useCallback((password) => runPasswordOperation(setupVault, password), [runPasswordOperation]);
  const unlock = useCallback((password) => runPasswordOperation(unlockVault, password), [runPasswordOperation]);

  const lock = useCallback(() => {
    const current = currentRef.current;
    // Invalidate every read/setup/unlock already in flight before clearing the
    // module-private session. A later stale success must not republish unlock.
    current.generation += 1;
    pendingRef.current = false;
    lockVault();
    if (identity && current.identity === identity) {
      resolvedIdentityRef.current = identity;
      setResult({ capability: LOCKED_CAPABILITY, checking: false, pending: false, error: "" });
    } else {
      current.identity = "";
      resolvedIdentityRef.current = "";
      setResult({ capability: LOCKED_CAPABILITY, checking: false, pending: false, error: "" });
    }
  }, [identity]);

  const identityResolved = Boolean(identity && resolvedIdentityRef.current === identity);
  return {
    capability: identityResolved ? result.capability : LOCKED_CAPABILITY,
    checking: identity ? (!identityResolved || result.checking) : false,
    pending: identityResolved ? result.pending : false,
    error: identityResolved ? result.error : "",
    setup,
    unlock,
    lock,
    refresh,
  };
}
