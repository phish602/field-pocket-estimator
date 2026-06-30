import { useEffect, useState } from "react";
import { getSupabaseClient } from "./supabaseClient";

function asRole(membership) {
  return String(membership?.role || membership?.user_role || "").trim();
}

function asCompanyId(membership) {
  const directId = String(membership?.company_id || membership?.companyId || "").trim();
  if (directId) return directId;
  const nestedId = String(membership?.company?.id || "").trim();
  return nestedId;
}

export default function useSupabaseAccount({ configured = false, user = null } = {}) {
  const [companyUser, setCompanyUser] = useState(null);
  const [company, setCompany] = useState(null);
  const [role, setRole] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const client = getSupabaseClient();
    const userId = String(user?.id || "").trim();

    setCompanyUser(null);
    setCompany(null);
    setRole("");
    setError("");

    if (!configured || !userId || !client?.from) {
      setLoading(false);
      return undefined;
    }

    let active = true;
    setLoading(true);

    const loadAccount = async () => {
      try {
        const membershipResponse = await client
          .from("company_users")
          .select("*")
          .eq("user_id", userId)
          .limit(1)
          .maybeSingle();

        if (!active) return;

        if (membershipResponse?.error) {
          setError("Unable to load company membership.");
          return;
        }

        const membership = membershipResponse?.data || null;
        if (!membership) {
          return;
        }

        const nextRole = asRole(membership);
        const companyId = asCompanyId(membership);
        setCompanyUser(membership);
        setRole(nextRole);

        if (!companyId) {
          setError("Unable to load company status.");
          return;
        }

        const companyResponse = await client
          .from("companies")
          .select("*")
          .eq("id", companyId)
          .maybeSingle();

        if (!active) return;

        if (companyResponse?.error) {
          setError("Unable to load company status.");
          return;
        }

        setCompany(companyResponse?.data || null);
      } catch {
        if (!active) return;
        setError("Unable to load company status.");
      } finally {
        if (active) setLoading(false);
      }
    };

    loadAccount();

    return () => {
      active = false;
    };
  }, [configured, user]);

  return {
    configured: Boolean(configured),
    user,
    companyUser,
    membership: companyUser,
    company,
    role,
    loading,
    error,
    hasCompany: Boolean(company),
  };
}
