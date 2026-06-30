import { useState } from "react";
import { getSupabaseClient } from "./supabaseClient";

const OWNER_ROLE = "owner";

function asMessage(error, fallback) {
  const message = String(error?.message || "").trim();
  return message || fallback;
}

export default function useSupabaseWorkspaceBootstrap({
  configured = false,
  user = null,
  hasMembership = false,
  onCreated = null,
} = {}) {
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [result, setResult] = useState(null);

  const createWorkspace = async (name) => {
    const workspaceName = String(name || "").trim();
    const userId = String(user?.id || "").trim();

    if (!workspaceName) {
      const message = "Enter a company or workspace name.";
      setError(message);
      setSuccess("");
      return { ok: false, error: message };
    }

    if (hasMembership) {
      const message = "Cloud workspace already exists for this account.";
      setError(message);
      setSuccess("");
      return { ok: false, error: message };
    }

    const client = getSupabaseClient();

    if (!configured || !client?.from || !userId) {
      const message = "Supabase not configured.";
      setError(message);
      setSuccess("");
      return { ok: false, error: message };
    }

    setCreating(true);
    setError("");
    setSuccess("");
    setResult(null);

    try {
      const companyResponse = await client
        .from("companies")
        .insert({
          name: workspaceName,
          created_by: userId,
          updated_by: userId,
        })
        .select("*")
        .single();

      if (companyResponse?.error || !companyResponse?.data) {
        const message = asMessage(companyResponse?.error, "Unable to create cloud workspace.");
        setError(message);
        return { ok: false, error: message };
      }

      const company = companyResponse.data;
      const companyId = String(company?.id || "").trim();

      if (!companyId) {
        const message = "Unable to create cloud workspace.";
        setError(message);
        return { ok: false, error: message };
      }

      const membershipResponse = await client
        .from("company_users")
        .insert({
          company_id: companyId,
          user_id: userId,
          role: OWNER_ROLE,
          created_by: userId,
          updated_by: userId,
        })
        .select("*")
        .single();

      if (membershipResponse?.error || !membershipResponse?.data) {
        const message = asMessage(membershipResponse?.error, "Unable to link your cloud workspace.");
        setError(message);
        return { ok: false, error: message };
      }

      const nextResult = {
        company,
        membership: membershipResponse.data,
        role: String(membershipResponse?.data?.role || OWNER_ROLE).trim() || OWNER_ROLE,
      };

      setResult(nextResult);
      setSuccess(`Cloud workspace created: ${workspaceName}`);

      if (typeof onCreated === "function") {
        await onCreated(nextResult);
      }

      return { ok: true, result: nextResult };
    } catch (error) {
      const message = asMessage(error, "Unable to create cloud workspace.");
      setError(message);
      return { ok: false, error: message };
    } finally {
      setCreating(false);
    }
  };

  return {
    createWorkspace,
    creating,
    error,
    success,
    result,
  };
}
