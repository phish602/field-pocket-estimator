import { useCallback, useEffect, useState } from "react";
import { getSupabaseClient } from "./supabaseClient";

function asRole(membership) {
  return String(membership?.role || membership?.user_role || "").trim();
}

function asCompanyId(membership) {
  const directId = String(membership?.company_id || membership?.companyId || "").trim();
  return directId || String(membership?.company?.id || "").trim();
}

function emptyResult({ requestedUserId = "", loading = false, error = "" } = {}) {
  return { requestedUserId, resolvedUserId: "", companyUser: null, company: null, role: "", loading, error };
}

export default function useSupabaseAccount({ configured = false, user = null } = {}) {
  const requestedUserId = String(user?.id || "").trim();
  const [result, setResult] = useState(() => emptyResult());
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    const requestId = requestedUserId;
    const shouldLoad = Boolean(configured && requestId);
    setResult(emptyResult({ requestedUserId: requestId, loading: shouldLoad }));
    if (!shouldLoad) return undefined;

    const client = getSupabaseClient();
    if (!client?.from) {
      setResult({ ...emptyResult({ requestedUserId: requestId, loading: false }), error: "Unable to load company membership." });
      return undefined;
    }

    let active = true;
    const finish = (next = {}) => {
      if (!active) return;
      setResult({
        requestedUserId: requestId,
        resolvedUserId: requestId,
        companyUser: null,
        company: null,
        role: "",
        loading: false,
        error: "",
        ...next,
      });
    };

    const loadAccount = async () => {
      try {
        const membershipResponse = await client.from("company_users").select("*").eq("user_id", requestId).limit(1).maybeSingle();
        if (!active) return;
        if (membershipResponse?.error) return finish({ error: "Unable to load company membership." });
        const membership = membershipResponse?.data || null;
        if (!membership) return finish();
        const companyId = asCompanyId(membership);
        if (!companyId) return finish({ error: "Unable to load company status." });
        const companyResponse = await client.from("companies").select("*").eq("id", companyId).maybeSingle();
        if (!active) return;
        if (companyResponse?.error || !companyResponse?.data) return finish({ error: "Unable to load company status." });
        finish({ companyUser: membership, company: companyResponse.data, role: asRole(membership) });
      } catch {
        finish({ error: "Unable to load company status." });
      }
    };
    loadAccount();
    return () => { active = false; };
  }, [configured, requestedUserId, refreshTick]);

  const resolvedForRequestedUser = Boolean(configured && requestedUserId && result.resolvedUserId === requestedUserId);
  const loading = Boolean(configured && requestedUserId && (!resolvedForRequestedUser || result.loading));
  const refresh = useCallback(() => {
    // The refreshed render cannot expose the prior resolved identity because
    // returned values below are always tied to requestedUserId.
    setResult(emptyResult({ requestedUserId, loading: Boolean(configured && requestedUserId) }));
    setRefreshTick((value) => value + 1);
  }, [configured, requestedUserId]);

  return {
    configured: Boolean(configured),
    user,
    companyUser: resolvedForRequestedUser ? result.companyUser : null,
    membership: resolvedForRequestedUser ? result.companyUser : null,
    company: resolvedForRequestedUser ? result.company : null,
    role: resolvedForRequestedUser ? result.role : "",
    loading,
    error: resolvedForRequestedUser ? result.error : "",
    hasCompany: Boolean(resolvedForRequestedUser && result.company),
    refresh,
  };
}
