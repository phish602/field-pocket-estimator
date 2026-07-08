import { STORAGE_KEYS } from "../constants/storageKeys";

const CUSTOM_TRADE_STARTERS_KEY = STORAGE_KEYS.SCOPE_TRADE_STARTERS || "estipaid-scope-trade-starters-v1";

export function createCustomTradeStarterId() {
  return `trade_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeCustomTradeStarterRecord(record = {}) {
  const source = record && typeof record === "object" ? record : {};
  const label = String(source.label || source.name || "").replace(/\s+/g, " ").trim();
  const text = String(source.text || source.body || source.description || "").replace(/\r\n?/g, "\n").trim();
  if (!label || !text) return null;
  const createdAtRaw = Number(source.createdAt || Date.now());
  const createdAt = Number.isFinite(createdAtRaw) && createdAtRaw > 0 ? createdAtRaw : Date.now();
  const updatedAtRaw = Number(source.updatedAt || createdAt);
  const updatedAt = Number.isFinite(updatedAtRaw) && updatedAtRaw > 0 ? updatedAtRaw : createdAt;
  return {
    id: String(source.id || "").trim() || createCustomTradeStarterId(),
    label,
    text,
    createdAt,
    updatedAt,
  };
}

export function normalizeCustomTradeStarterList(records = []) {
  const seen = new Set();
  const next = [];
  for (const record of Array.isArray(records) ? records : []) {
    const normalized = normalizeCustomTradeStarterRecord(record);
    if (!normalized || seen.has(normalized.id)) continue;
    seen.add(normalized.id);
    next.push(normalized);
  }
  next.sort((a, b) => {
    const delta = Number(b.updatedAt || 0) - Number(a.updatedAt || 0);
    if (delta !== 0) return delta;
    return String(a.label || "").localeCompare(String(b.label || ""));
  });
  return next;
}

export function readStoredCustomTradeStarters() {
  try {
    const raw = localStorage.getItem(CUSTOM_TRADE_STARTERS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return normalizeCustomTradeStarterList(parsed);
  } catch {
    return [];
  }
}

export function writeStoredCustomTradeStarters(starters = []) {
  const next = normalizeCustomTradeStarterList(starters);
  try {
    const value = JSON.stringify(next);
    localStorage.setItem(CUSTOM_TRADE_STARTERS_KEY, value);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("pe-localstorage", { detail: { key: CUSTOM_TRADE_STARTERS_KEY, value } }));
    }
  } catch {}
  return next;
}

export function extractTradeInsertBlocksForPdf(scopeText, explicitTradeText, curatedTradeInserts = []) {
  const fromScope = String(scopeText || "");
  const unique = new Set();
  const out = [];
  const push = (text) => {
    const val = String(text || "").trim();
    if (!val || unique.has(val)) return;
    unique.add(val);
    out.push(val);
  };

  // Known curated trade inserts
  for (const item of Array.isArray(curatedTradeInserts) ? curatedTradeInserts : []) {
    const txt = String(item?.text || "").trim();
    if (txt && fromScope.includes(txt)) push(txt);
  }

  // Manual "Trade Insert:" blocks
  const tradeBlockPattern = /(Trade Insert:[\s\S]*?)(?=\n{2,}Trade Insert:|\s*$)/gi;
  const manualBlocks = fromScope.match(tradeBlockPattern) || [];
  manualBlocks.forEach((block) => push(block));

  // Explicit tracked insert
  push(explicitTradeText);
  return out;
}

export function stripTradeInsertBlocksFromScope(scopeText, tradeBlocks) {
  let next = String(scopeText || "");
  for (const block of tradeBlocks || []) {
    const txt = String(block || "").trim();
    if (!txt) continue;
    next = next.replace(txt, "\n\n");
  }
  return next.replace(/\n{3,}/g, "\n\n").trim();
}
