import { getSupabaseClient } from "./supabaseClient";
import { buildLocalStorageExportArtifact } from "./localStorageExportArtifact";

export const SUPABASE_ESTIMATE_RESTORE_PAYLOAD_VERSION = "supabase-estimate-restore-payload-v1";
export const ESTIMATE_RESTORE_PAYLOAD_SCHEMA = "estipaid.estimate.restore_payload";
export const ESTIMATE_RESTORE_PAYLOAD_VERSION = "1";

export const ESTIMATE_PAYLOAD_UPDATE_STATUS = {
  SIGNED_OUT: "signed_out",
  NO_WORKSPACE: "no_workspace",
  NO_LOCAL_ESTIMATES: "no_local_estimates",
  COMPLETED: "completed",
  ERROR: "error",
};

function asText(value) {
  return String(value || "").trim();
}

function gateBasicPrerequisites({ configured, user, company }) {
  const userId = asText(user?.id);
  const companyId = asText(company?.id);
  if (!configured || !userId) return ESTIMATE_PAYLOAD_UPDATE_STATUS.SIGNED_OUT;
  if (!companyId) return ESTIMATE_PAYLOAD_UPDATE_STATUS.NO_WORKSPACE;
  return null;
}

function readLocalEstimates(storageSnapshot) {
  const artifact = buildLocalStorageExportArtifact(storageSnapshot);
  const parsed = artifact?.parsedData?.migration?.estimates?.parsed;
  return Array.isArray(parsed) ? parsed : [];
}

async function readCloudEstimateLegacyIds(client, companyId) {
  const response = await client
    .from("estimates")
    .select("id, legacy_local_id")
    .eq("company_id", companyId);

  if (response?.error) throw response.error;
  return Array.isArray(response?.data) ? response.data : [];
}

// Wraps the exact local estimate record (the same object the app already
// stores in estipaid-estimates-v1 and reopens for editing) in a small
// versioned envelope. Stores the full record verbatim -- this is a capture
// of data that already exists locally, not a reconstruction or guess, so no
// estimator field is invented.
export function buildEstimateRestorePayload(localEstimate) {
  return {
    schema: ESTIMATE_RESTORE_PAYLOAD_SCHEMA,
    version: 1,
    capturedFrom: "localStorage",
    legacyLocalId: asText(localEstimate?.id),
    estimate: localEstimate,
  };
}

function buildResult(status, extra = {}) {
  return {
    payloadUpdateVersion: SUPABASE_ESTIMATE_RESTORE_PAYLOAD_VERSION,
    status,
    estimatesChecked: 0,
    estimatesUpdated: 0,
    missingCloudRows: [],
    skipped: [],
    failed: [],
    noLocalDataChanged: true,
    ...extra,
  };
}

// Explicit, click-only action. For each local estimate that already has a
// matching cloud estimate row (by company_id + legacy_local_id), captures
// the full local estimate record into restore_payload via an UPDATE scoped
// to that exact row. Never inserts, upserts, or deletes any row, and never
// reads/writes localStorage data -- only the in-memory local estimate list
// is read to build payloads.
export async function updateEstimateRestorePayloads({
  storageSnapshot,
  configured = false,
  user = null,
  company = null,
} = {}) {
  const gated = gateBasicPrerequisites({ configured, user, company });
  if (gated) return buildResult(gated);

  const client = getSupabaseClient();
  if (!client?.from) {
    return buildResult(ESTIMATE_PAYLOAD_UPDATE_STATUS.ERROR, {
      error: "Supabase is not configured.",
    });
  }

  const localEstimates = readLocalEstimates(storageSnapshot);
  if (localEstimates.length === 0) {
    return buildResult(ESTIMATE_PAYLOAD_UPDATE_STATUS.NO_LOCAL_ESTIMATES);
  }

  const companyId = asText(company?.id);
  let cloudRows;
  try {
    cloudRows = await readCloudEstimateLegacyIds(client, companyId);
  } catch (error) {
    return buildResult(ESTIMATE_PAYLOAD_UPDATE_STATUS.ERROR, {
      error: asText(error?.message) || "Unable to read cloud estimates.",
    });
  }
  const cloudLegacyIds = new Set(cloudRows.map((row) => asText(row?.legacy_local_id)).filter(Boolean));

  const missingCloudRows = [];
  const skipped = [];
  const failed = [];
  let estimatesUpdated = 0;
  let estimatesChecked = 0;

  for (const localEstimate of localEstimates) {
    const legacyLocalId = asText(localEstimate?.id);
    estimatesChecked += 1;

    if (!legacyLocalId) {
      skipped.push({ legacyLocalId: "", reason: "Local estimate is missing its local id." });
      continue;
    }

    if (!cloudLegacyIds.has(legacyLocalId)) {
      missingCloudRows.push({ legacyLocalId, reason: "No matching cloud estimate found for this company." });
      continue;
    }

    const payload = buildEstimateRestorePayload(localEstimate);
    let serialized;
    try {
      serialized = JSON.parse(JSON.stringify(payload));
    } catch (error) {
      failed.push({ legacyLocalId, reason: "Estimate could not be serialized into a JSON object." });
      continue;
    }

    try {
      const response = await client
        .from("estimates")
        .update({
          restore_payload: serialized,
          restore_payload_version: ESTIMATE_RESTORE_PAYLOAD_VERSION,
          restore_payload_captured_at: new Date().toISOString(),
        })
        .eq("company_id", companyId)
        .eq("legacy_local_id", legacyLocalId)
        .select("id");

      if (response?.error) {
        failed.push({ legacyLocalId, reason: asText(response.error?.message) || "Update failed." });
        continue;
      }

      if (!Array.isArray(response?.data) || response.data.length === 0) {
        failed.push({ legacyLocalId, reason: "Update affected no rows." });
        continue;
      }

      estimatesUpdated += 1;
    } catch (error) {
      failed.push({ legacyLocalId, reason: asText(error?.message) || "Update failed." });
    }
  }

  return buildResult(ESTIMATE_PAYLOAD_UPDATE_STATUS.COMPLETED, {
    estimatesChecked,
    estimatesUpdated,
    missingCloudRows,
    skipped,
    failed,
  });
}
