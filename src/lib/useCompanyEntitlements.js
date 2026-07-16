// Shared React hook for the server-resolved entitlement state.
//
// One authority path for every subscription consumer: App and Company Profile
// both read from here so a browser cannot make them disagree. There is no
// localStorage read anywhere in this module.
//
// Local fallback exists ONLY for development/test convenience and is refused on
// any production host -- see allowLocalEntitlementFallback().

import { useCallback, useEffect, useState } from "react";
import { resolveCompanyEntitlements, getFreeEntitlementState, getLoadingEntitlementState } from "./companyEntitlementsApi";

// A production hostname must never enable local fallback, regardless of how the
// bundle was built. NODE_ENV alone is not enough: a preview/production Vercel
// build served from a real host must always be server-authoritative.
export function allowLocalEntitlementFallback({ nodeEnv = process.env.NODE_ENV, hostname } = {}) {
  const host = String(
    hostname ?? (typeof window !== "undefined" ? window.location?.hostname : "") ?? ""
  ).trim().toLowerCase();
  if (!host) return nodeEnv === "test";
  const isLocalHost = host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".local");
  if (!isLocalHost) return false;
  return nodeEnv !== "production";
}

export function useCompanyEntitlements({ configured = false, companyId = "", accessToken = "", fetchImpl } = {}) {
  const [state, setState] = useState(() => getFreeEntitlementState({ code: "idle" }));

  const load = useCallback(async (signal) => {
    // Without a session or company there is nothing to resolve: stay Free.
    if (!configured || !companyId || !accessToken) {
      if (!signal?.cancelled) setState(getFreeEntitlementState({ code: "missing_context" }));
      return;
    }
    // While resolving, present as Free -- never as a previous plan.
    if (!signal?.cancelled) setState(getLoadingEntitlementState());
    const resolved = await resolveCompanyEntitlements({ accessToken, companyId, fetchImpl });
    if (!signal?.cancelled) setState(resolved);
  }, [configured, companyId, accessToken, fetchImpl]);

  useEffect(() => {
    const signal = { cancelled: false };
    load(signal);
    return () => { signal.cancelled = true; };
  }, [load]);

  return state;
}
