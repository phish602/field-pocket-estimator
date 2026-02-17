// server/dev-ai.js
const express = require("express");
const { fetch } = require("undici");

const app = express();
app.use(express.json({ limit: "1mb" }));

const OLLAMA_BASE = "http://127.0.0.1:11434";
const MODEL = "llama3.2:1b"; // fallback only (speed)
const OLLAMA_TIMEOUT_MS = 60000;

console.log("LOADED dev-ai.js v6 RULE_PARSER_FIRST + STRICT_SANITIZE + V1_LABOR_ENGINE");

function fetchWithTimeout(url, options, ms) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(id));
}

function extractJsonPayload(text) {
  const t = String(text || "").trim();
  try { return JSON.parse(t); } catch {}
  let s = t.replace(/^```[a-zA-Z]*\s*/i, "").replace(/```$/i, "").trim();
  try { return JSON.parse(s); } catch {}
  const a = s.indexOf("{");
  const b = s.lastIndexOf("}");
  if (a !== -1 && b !== -1 && b > a) {
    try { return JSON.parse(s.slice(a, b + 1)); } catch {}
  }
  return null;
}

function toNumOrNull(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toBoolOrNull(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "boolean") return v;
  const s = String(v).trim().toLowerCase();
  if (["true","yes","y","yeah","yep","si"].includes(s)) return true;
  if (["false","no","n","nah","nope"].includes(s)) return false;
  return null;
}

function roundUpToQuarterHour(hours) {
  const h = Number(hours);
  if (!Number.isFinite(h) || h <= 0) return 0;
  return Math.ceil(h * 4) / 4;
}
function ceil(n) {
  const x = Number(n);
  if (!Number.isFinite(x) || x <= 0) return 0;
  return Math.ceil(x);
}

/**
 * Hard sanitize to our schema no matter what:
 * trade, scopeType, rooms, sqft, stories, ceilingHeightFt, coats, prep,
 * includeCeilings, includeTrimDoors, needForeman
 */
function sanitizeState(raw) {
  const p = raw && typeof raw === "object" ? raw : {};

  const out = {
    trade: "painting",
    scopeType: null,
    scopeBasis: null, // "rooms" | "sqft" (interior only)
    rooms: null,
    sqft: null,
    stories: null,
    ceilingHeightFt: null,
    coats: null,
    prep: null,
    includeCeilings: null,
    includeTrimDoors: null,
    needForeman: null,
  };

  if (typeof p.scopeType === "string") {
    const s = p.scopeType.trim().toLowerCase();
    out.scopeType = (s === "interior" || s === "exterior") ? s : null;
  }

if (typeof p.scopeBasis === "string") {
  const b = p.scopeBasis.trim().toLowerCase();
  out.scopeBasis = (b === "rooms" || b === "sqft") ? b : null;
}


  // rooms MUST be number or null (never array/object)
  const rn = toNumOrNull(p.rooms);
  out.rooms = rn && rn > 0 ? rn : null;

  out.sqft = toNumOrNull(p.sqft);
  out.stories = toNumOrNull(p.stories);
  out.ceilingHeightFt = toNumOrNull(p.ceilingHeightFt);
  out.coats = toNumOrNull(p.coats);

  if (typeof p.prep === "string") {
    const pr = p.prep.trim().toLowerCase();
    out.prep = ["light","medium","heavy"].includes(pr) ? pr : null;
  }

  out.includeCeilings = toBoolOrNull(p.includeCeilings);
  out.includeTrimDoors = toBoolOrNull(p.includeTrimDoors);
  out.needForeman = toBoolOrNull(p.needForeman);

  return out;
}

function mergePatch(base, patch) {
  const out = { ...(base || {}) };
  for (const k of Object.keys(patch || {})) {
    const v = patch[k];
    if (v !== null && v !== undefined && v !== "") out[k] = v;
  }
  return out;
}


function isVagueStarterMessage(message) {
  const s = String(message || "").trim().toLowerCase();
  if (!s) return true;
  // Very short or generic prompts that should trigger onboarding instead of guardrail interrogation.
  if (s.length <= 8) return true;
  return (
    s === "help" ||
    s === "start" ||
    s === "hi" ||
    s === "hello" ||
    s === "yo" ||
    s === "sup" ||
    s.includes("what do i do") ||
    s.includes("what should i do") ||
    s.includes("how do i start") ||
    s.includes("where do i start")
  );
}

function onboardingQuestion(lang) {
  const language = lang === "es" ? "es" : "en";
  return language === "es"
    ? "Dime qué quieres estimar y un dato de tamaño. Ejemplos: \"pintura interior 3 cuartos\" o \"casa exterior 2000 sqft\". (También puedo hacer solo paredes o paredes+techos)."
    : "Tell me what you’re estimating and one size clue. Examples: \"interior paint 3 rooms\" or \"exterior house 2000 sqft\". (I can do walls only or walls+ceilings.)";
}

function describeValue(key, val, lang) {
  const language = lang === "es" ? "es" : "en";
  if (val === null || val === undefined || val === "") return "";
  const v = val;
  const num = toNumOrNull(v);
  if (key === "scopeType") return language === "es" ? (v === "interior" ? "interior" : "exterior") : v;
  if (key === "rooms" && num !== null) return language === "es" ? `${num} cuartos` : `${num} room${num === 1 ? "" : "s"}`;
  if (key === "sqft" && num !== null) return language === "es" ? `${num} sqft aprox.` : `~${num} sqft`;
  if (key === "stories" && num !== null) return language === "es" ? `${num} piso${num === 1 ? "" : "s"}` : `${num} stor${num === 1 ? "y" : "ies"}`;
  if (key === "coats" && num !== null) return language === "es" ? `${num} capa${num === 1 ? "" : "s"}` : `${num} coat${num === 1 ? "" : "s"}`;
  if (key === "ceilingHeightFt" && num !== null) return language === "es" ? `${num} ft de altura` : `${num}ft ceilings`;
  if (key === "prep" && typeof v === "string") return language === "es" ? `prep ${v}` : `${v} prep`;
  if (key === "includeCeilings" && typeof v === "boolean") return language === "es" ? (v ? "incluye techos" : "sin techos") : (v ? "including ceilings" : "no ceilings");
  if (key === "includeTrimDoors" && typeof v === "boolean") return language === "es" ? (v ? "incluye molduras/puertas" : "sin molduras/puertas") : (v ? "including trim/doors" : "no trim/doors");
  if (key === "needForeman" && typeof v === "boolean") return language === "es" ? (v ? "con capataz" : "sin capataz") : (v ? "with foreman" : "no foreman");
  if (key === "scopeBasis" && typeof v === "string") return language === "es" ? `usar ${v}` : `use ${v}`;
  return String(v);
}

function humanAsk(key, state, lang) {
  const language = lang === "es" ? "es" : "en";
  const s = sanitizeState(state || {});
  // Short, non-scripted prompts with examples.
  if (key === "scopeType") return onboardingQuestion(lang);
  if (key === "scopeBasis") {
    return language === "es"
      ? "Tengo cuartos y pies cuadrados. ¿Cuál prefieres usar para calcular? Responde: rooms o sqft."
      : "I’ve got rooms and square feet. Which should I use to calculate? Reply: rooms or sqft.";
  }
  if (key === "rooms") {
    return language === "es"
      ? "¿Cuántos cuartos/habitaciones vas a pintar? (ej: 3)"
      : "How many rooms are you painting? (ex: 3)";
  }
  if (key === "sqft") {
    return language === "es"
      ? "¿Aproximadamente cuántos pies cuadrados? (un número rápido está bien)"
      : "Roughly how many square feet? (a quick number is fine)";
  }
  if (key === "stories") {
    return language === "es" ? "¿Cuántos pisos? (1, 2, 3+)" : "How many stories? (1, 2, 3+)";
  }
  if (key === "ceilingHeightFt") {
    return language === "es" ? "¿Altura del techo en pies? (8, 9, 10)" : "Ceiling height in feet? (8, 9, 10)";
  }
  if (key === "coats") {
    return language === "es" ? "¿Cuántas capas/manos? (1, 2, 3)" : "How many coats? (1, 2, 3)";
  }
  if (key === "prep") {
    return language === "es"
      ? "¿Qué nivel de preparación? (light / medium / heavy)"
      : "Prep level? (light / medium / heavy)";
  }
  if (key === "includeCeilings") {
    return language === "es" ? "¿Incluimos techos? (sí/no)" : "Include ceilings? (yes/no)";
  }
  if (key === "includeTrimDoors") {
    return language === "es" ? "¿Incluimos molduras y puertas? (sí/no)" : "Include trim and doors? (yes/no)";
  }
  if (key === "needForeman") {
    return language === "es" ? "¿Quieres capataz/foreman en este trabajo? (sí/no)" : "Do you want a foreman on this job? (yes/no)";
  }
  return language === "es" ? "Dame un poco más de detalle." : "Give me a bit more detail.";
}

function withAck(nextQuestion, filledKey, filledVal, lang) {
  const language = lang === "es" ? "es" : "en";
  if (!nextQuestion) return "";
  if (!filledKey) return nextQuestion;
  const dv = describeValue(filledKey, filledVal, lang);
  if (!dv) return nextQuestion;
  const ack = language === "es" ? `Perfecto — ${dv}. ` : `Got it — ${dv}. `;
  return ack + nextQuestion;
}


function isUnsure(message) {
  const s = String(message || "").trim().toLowerCase();
  return (
    s === "idk" || s === "i dunno" || s === "dont know" || s === "don't know" ||
    s === "not sure" || s === "unsure" || s === "no idea" || s === "whatever" ||
    s === "you decide" || s === "up to you"
  );
}

function soften(question, lang) {
  const language = lang === "es" ? "es" : "en";
  if (!question) return "";
  // Make it feel like a person, not a checklist.
  if (language === "es") {
    return `Ok — ${question}`;
  }
  return `Alright — ${question}`;
}

function oneLinerStatus(state, lang) {
  const language = lang === "es" ? "es" : "en";
  const s = sanitizeState(state || {});
  const bits = [];
  if (s.scopeType) bits.push(s.scopeType);
  if (s.scopeBasis) bits.push(`basis ${s.scopeBasis}`);
  if (s.rooms) bits.push(`${s.rooms} rooms`);
  if (s.sqft) bits.push(`~${s.sqft} sqft`);
  if (s.stories) bits.push(`${s.stories} stories`);
  if (s.coats) bits.push(`${s.coats} coats`);
  if (s.prep) bits.push(`${s.prep} prep`);
  if (typeof s.includeCeilings === "boolean") bits.push(s.includeCeilings ? "ceilings" : "no ceilings");
  if (typeof s.includeTrimDoors === "boolean") bits.push(s.includeTrimDoors ? "trim/doors" : "no trim/doors");
  if (typeof s.needForeman === "boolean") bits.push(s.needForeman ? "foreman" : "no foreman");
  if (!bits.length) return "";
  if (language === "es") return `Lo que tengo: ${bits.join(" • ")}.`;
  return `What I have: ${bits.join(" • ")}.`;
}

function defaultForMissing(key, lang) {
  const language = lang === "es" ? "es" : "en";
  // Safe-ish defaults used ONLY when user says "idk / not sure".
  if (key === "coats") return 2;
  if (key === "prep") return "light";
  if (key === "includeCeilings") return false;
  if (key === "includeTrimDoors") return true;
  if (key === "needForeman") return false;
  if (key === "ceilingHeightFt") return 8;
  if (key === "stories") return 1;
  // sqft/rooms should not be defaulted silently
  return null;
}

function applyUnsureDefault(state, missingKey, lang) {
  const s = sanitizeState(state || {});
  const d = defaultForMissing(missingKey, lang);
  if (d === null || d === undefined) return { state: s, applied: false };
  s[missingKey] = d;
  return { state: s, applied: true };
}


/**
 * FAST RULE PARSER (instant, no model):
 * Pulls out common estimate phrases.
 */
function ruleParseMessage(message, currentState) {
  const msg = String(message || "").toLowerCase();
  const rawTrim = String(message || "").trim();
  const patch = {};

  const cur = sanitizeState(currentState || {});
  const numOnly = rawTrim.match(/^\s*(\d+(?:\.\d+)?)\s*$/);
  const numVal = numOnly ? Number(numOnly[1]) : null;

  // =========================================================
  // ZERO-AMBIGUITY NUMERIC REPLIES (context-aware)
  // If the user replies with ONLY a number, treat it as the
  // next required field (first missing key) whenever possible.
  // =========================================================
  if (numVal !== null && Number.isFinite(numVal)) {
    try {
      const guarded = applyGuardrailsAndNextQuestion(cur, "en");
      const missing = Array.isArray(guarded?.missing) ? guarded.missing : [];
      const targetField = missing.length ? String(missing[0]) : "";

      // Only map numeric-only replies to numeric fields.
      if (targetField === "rooms" && numVal > 0) {
        patch.rooms = numVal;
      } else if (targetField === "sqft" && numVal > 0) {
        patch.sqft = numVal;
      } else if (targetField === "stories" && numVal > 0) {
        patch.stories = numVal;
      } else if (targetField === "coats" && numVal > 0) {
        patch.coats = numVal;
      } else if (targetField === "ceilingHeightFt" && numVal > 0) {
        patch.ceilingHeightFt = numVal;
      }

      if (Object.keys(patch).length) {
        patch.trade = "painting";
        return sanitizeState(patch);
      }
    } catch {
      // ignore
    }
  }

  // ============================
  // NORMAL RULE PARSER
  // ============================

  if (/\bexterior\b/.test(msg) || /\boutside\b/.test(msg)) patch.scopeType = "exterior";
  if (/\binterior\b/.test(msg) || /\binside\b/.test(msg)) patch.scopeType = "interior";

  // Basis preference when both rooms + sqft exist (interior): user can force which to use.
  if (/\b(use|prefer|basis)\s+(rooms?)\b/.test(msg) || /\brooms?\s+(only|basis)\b/.test(msg)) patch.scopeBasis = "rooms";
  if (msg.trim() === "rooms" || msg.trim() === "room") patch.scopeBasis = "rooms";

  if (/\b(use|prefer|basis)\s+(sq\s*ft|sqft|sf|square\s*feet)\b/.test(msg) || /\b(sq\s*ft|sqft|sf|square\s*feet)\s+(only|basis)\b/.test(msg)) patch.scopeBasis = "sqft";
  if (["sqft","sf","square feet","squarefeet","sq ft"].includes(msg.trim())) patch.scopeBasis = "sqft";

  const sqftMatch = msg.match(/(\d{1,3}(?:,\d{3})+|\d+)\s*(sq\s*ft|sqft|square\s*feet|sf)\b/);
  if (sqftMatch) patch.sqft = Number(String(sqftMatch[1]).replace(/,/g, ""));

  const storyMatch = msg.match(/(\d+)\s*(story|stories)\b/);
  if (storyMatch) patch.stories = Number(storyMatch[1]);
  if (!patch.stories) {
    if (/\bone[-\s]?story\b/.test(msg)) patch.stories = 1;
    if (/\btwo[-\s]?story\b/.test(msg)) patch.stories = 2;
    if (/\bthree[-\s]?story\b/.test(msg)) patch.stories = 3;
  }

  const coatMatch = msg.match(/(\d+)\s*(coat|coats)\b/);
  if (coatMatch) patch.coats = Number(coatMatch[1]);
  if (!patch.coats) {
    if (/\bone\s+coat\b/.test(msg)) patch.coats = 1;
    if (/\btwo\s+coats\b/.test(msg)) patch.coats = 2;
    if (/\bthree\s+coats\b/.test(msg)) patch.coats = 3;
  }

  if (/\blight\s+prep\b/.test(msg) || /\bminor\s+prep\b/.test(msg)) patch.prep = "light";
  if (/\bmedium\s+prep\b/.test(msg) || /\bmoderate\s+prep\b/.test(msg)) patch.prep = "medium";
  if (/\bheavy\s+prep\b/.test(msg) || /\bmajor\s+prep\b/.test(msg)) patch.prep = "heavy";

  if (/\b(include|with)\s+(trim|doors|trim\s*and\s*doors)\b/.test(msg)) patch.includeTrimDoors = true;
  if (/\b(no|exclude|without)\s+(trim|doors|trim\s*and\s*doors)\b/.test(msg)) patch.includeTrimDoors = false;

  // Foreman detection (handles: "foreman no", "foreman: yes", "foreman = no", "no foreman", etc.)
  const fm = msg.match(/\bforeman\s*(?:[:=]|\s)\s*(yes|no)\b/);
  if (fm) patch.needForeman = fm[1] === "yes";

  if (/\bneed\s+a\s+foreman\b/.test(msg) || /\bwith\s+foreman\b/.test(msg)) patch.needForeman = true;
  if (/\bno\s+foreman\b/.test(msg) || /\bwithout\s+foreman\b/.test(msg)) patch.needForeman = false;

  const roomsMatch = msg.match(/(\d+)\s*(rooms|room|bedrooms|bedroom)\b/);
  if (roomsMatch) patch.rooms = Number(roomsMatch[1]);

  if (/\b(include|with)\s+ceilings?\b/.test(msg)) patch.includeCeilings = true;
  if (/\b(no|exclude|without)\s+ceilings?\b/.test(msg)) patch.includeCeilings = false;

  const ch = msg.match(/(\d+(?:\.\d+)?)\s*(ft|feet)\s*(ceiling|ceilings)\b/);
  if (ch) patch.ceilingHeightFt = Number(ch[1]);

  patch.trade = "painting";
  return sanitizeState(patch);
}

function applyGuardrailsAndNextQuestion(state, lang) {
  const language = lang === "es" ? "es" : "en";
  const s = sanitizeState(state);

  if (!s.scopeType) {
    return {
      state: s,
      missing: ["scopeType"],
      nextQuestion: humanAsk("scopeType", current, lang),
    };
  }

  if (s.scopeType === "exterior") {
    s.rooms = null;
    s.includeCeilings = null;
    s.ceilingHeightFt = null;

    if (!s.stories) {
  return {
    state: s,
    missing: ["stories"],
    nextQuestion: humanAsk("stories", s, lang),
  };
}
if (!s.sqft) {
  return {
    state: s,
    missing: ["sqft"],
    nextQuestion: humanAsk("sqft", s, lang),
  };
}

    if (!s.coats) {
      return {
        state: s,
        missing: ["coats"],
        nextQuestion: humanAsk("coats", s, lang),
      };
    }
    if (!s.prep) {
      return {
        state: s,
        missing: ["prep"],
        nextQuestion: humanAsk("prep", s, lang),
      };
    }
    if (s.includeTrimDoors === null) {
      return {
        state: s,
        missing: ["includeTrimDoors"],
        nextQuestion: humanAsk("includeTrimDoors", s, lang),
      };
    }
    if (s.needForeman === null) {
      return {
        state: s,
        missing: ["needForeman"],
        nextQuestion: humanAsk("needForeman", s, lang),
      };
    }
    return { state: s, missing: [], nextQuestion: "" };
  }

  const hasRooms = !!s.rooms;
  const hasSqft = !!s.sqft;

if (s.scopeType === "interior" && hasRooms && hasSqft && !s.scopeBasis) {
  return {
    state: s,
    missing: ["scopeBasis"],
    nextQuestion: humanAsk("scopeBasis", s, lang),
  };
}

  if (!hasRooms && !hasSqft) {
    return {
      state: s,
      missing: ["rooms"],
      nextQuestion: humanAsk("rooms", s, lang),
    };
  }
  if (!s.coats) {
    return {
      state: s,
      missing: ["coats"],
      nextQuestion: language === "es" ? "¿Cuántas manos/capas? (1, 2, 3)" : "How many coats? (1, 2, 3)",
    };
  }
  if (!s.prep) {
    return {
      state: s,
      missing: ["prep"],
      nextQuestion: language === "es"
        ? "¿Preparación: ligera, media o pesada?"
        : "Prep level: light, medium, or heavy?",
    };
  }
  if (s.includeCeilings === null) {
    return {
      state: s,
      missing: ["includeCeilings"],
      nextQuestion: humanAsk("includeCeilings", s, lang),
    };
  }
  if (hasRooms && !s.ceilingHeightFt) {
    return {
      state: s,
      missing: ["ceilingHeightFt"],
      nextQuestion: humanAsk("ceilingHeightFt", s, lang),
    };
  }
  if (s.includeTrimDoors === null) {
    return {
      state: s,
      missing: ["includeTrimDoors"],
      nextQuestion: language === "es" ? "¿Incluir molduras/puertas? (sí/no)" : "Include trim and doors? (yes/no)",
    };
  }
  if (s.needForeman === null) {
    return {
      state: s,
      missing: ["needForeman"],
      nextQuestion: language === "es"
        ? "¿Necesitas capataz/foreman? (sí/no)"
        : "Do you need a foreman on this job? (yes/no)",
    };
  }

  return { state: s, missing: [], nextQuestion: "" };
}

function computePaintingDraftPlan(state) {
  const s = sanitizeState(state);

  const scope = s.scopeType;
  const coats = toNumOrNull(s.coats) || 1;
  const stories = toNumOrNull(s.stories) || 1;
  const prep = s.prep || "light";

  const prepMultMap = { light: 1.0, medium: 1.25, heavy: 1.55 };
  const prepMult = prepMultMap[prep] || 1.0;
  const coatMult = 1 + 0.75 * (coats - 1);

  let effectiveSqft = null;
  let trimHours = 0;
  let ceilingAddon = 0;
  let baseRate = 0;
  let storyMult = 1.0;

  const notes = [];

  if (scope === "interior") {
    const sqft = toNumOrNull(s.sqft);
    const rooms = toNumOrNull(s.rooms);
    const includeCeilings = s.includeCeilings === true;
    const ceilingHeightFt = toNumOrNull(s.ceilingHeightFt);
// Interior effective sqft selection:
// - If scopeBasis is set, honor it.
// - Otherwise: rooms -> sqft (legacy).
if (s.scopeBasis === "sqft" && sqft) {
  effectiveSqft = sqft;
} else if ((s.scopeBasis === "rooms" || !s.scopeBasis) && rooms) {
  const sqftPerRoomWalls = 400;
  const ceilingSqftPerRoom = 150;
  const heightFactor = ceilingHeightFt && ceilingHeightFt > 0 ? ceilingHeightFt / 8 : 1;

  const wallsSqft = rooms * sqftPerRoomWalls * heightFactor;
  const ceilingsSqft = includeCeilings ? rooms * ceilingSqftPerRoom : 0;
  effectiveSqft = wallsSqft + ceilingsSqft;

  notes.push("Interior sqft estimated from rooms (v1 defaults).");
  if (!ceilingHeightFt) notes.push("Ceiling height not provided; assumed 8ft for room-to-sqft conversion.");
} else if (sqft) {
  effectiveSqft = sqft;
}


    baseRate = 160;

    if (s.includeTrimDoors === true) {
      if (rooms) trimHours = rooms * 0.75;
      else trimHours = Math.max(2, (effectiveSqft || 0) / 1000 * 2.5);
    }

    if (includeCeilings) ceilingAddon = rooms ? rooms * 0.25 : Math.max(0.5, (effectiveSqft || 0) / 2000);

  } else if (scope === "exterior") {
    effectiveSqft = toNumOrNull(s.sqft);
    baseRate = 120;

    if (stories === 1) storyMult = 1.0;
    else if (stories === 2) storyMult = 1.2;
    else if (stories >= 3) storyMult = 1.35;

    if (s.includeTrimDoors === true) {
      trimHours = Math.max(2, (effectiveSqft || 0) / 1000 * 3.0);
    }
  } else {
    return null;
  }

  if (!effectiveSqft || !Number.isFinite(effectiveSqft) || effectiveSqft <= 0) return null;

  let painterHours = (effectiveSqft / baseRate) * coatMult * prepMult;
  if (scope === "exterior") painterHours *= storyMult;
  painterHours += trimHours + ceilingAddon;
  painterHours = roundUpToQuarterHour(painterHours);

  let foremanHours = 0;
  if (s.needForeman === true) {
    foremanHours = Math.max(4, painterHours * 0.15);
    foremanHours = roundUpToQuarterHour(foremanHours);
  }

  const COVERAGE = 350;
  const WASTE = 1.15;

  const paintGallons = ceil((effectiveSqft * coats) / COVERAGE * WASTE);

  let primerGallons = 0;
  if (prep === "medium" || prep === "heavy") {
    primerGallons = ceil((effectiveSqft * 0.6) / COVERAGE * WASTE);
  }

  let consumables = effectiveSqft * 0.08;
  if (prep === "medium") consumables *= 1.15;
  if (prep === "heavy") consumables *= 1.3;
  consumables = Math.round(consumables);

  return {
    effectiveSqft: Math.round(effectiveSqft),
    labor: [
      { role: "Painter", hours: painterHours },
      ...(foremanHours > 0 ? [{ role: "Foreman", hours: foremanHours }] : []),
    ],
    materials: [
      { name: "Paint", qty: paintGallons, unit: "gallon" },
      ...(primerGallons > 0 ? [{ name: "Primer", qty: primerGallons, unit: "gallon" }] : []),
      { name: "Consumables allowance", qty: consumables, unit: "USD" },
    ],
    notes,
  };
}



function planToFpeDraft(draftPlan, patch, lang) {
  if (!draftPlan || typeof draftPlan !== "object") return null;

  // Match FPE's exact line shapes:
  // newLaborLine(): { label:"", hours:"", rate:"", internalRate:"", qty: 1 }
  // newMaterialItem(): { desc:"", qty: 1, cost:"", charge:"" }

  const laborLines = Array.isArray(draftPlan.labor)
    ? draftPlan.labor.map((l) => {
        const role = String(l?.role || "").trim();
        const hoursNum = toNumOrNull(l?.hours);
        return {
          label: role,
          hours: hoursNum === null ? "" : String(hoursNum),
          rate: "",
          internalRate: "",
          qty: 1,
        };
      })
    : [];

  const materialLines = Array.isArray(draftPlan.materials)
    ? draftPlan.materials.map((m) => {
        const name = String(m?.name || "").trim();
        const qtyNum = toNumOrNull(m?.qty);

        // If this is an allowance in USD, set charge to the allowance amount (qty is 1).
        const unit = String(m?.unit || "").trim();
        if (unit.toUpperCase() === "USD") {
          return {
            desc: name,
            qty: 1,
            cost: "",
            charge: qtyNum === null ? "" : String(qtyNum),
          };
        }

        return {
          desc: name,
          qty: qtyNum === null ? 1 : qtyNum,
          cost: "",
          charge: "",
        };
      })
    : [];

  const language = lang === "es" ? "es" : "en";
  const planMeta = {
    trade: patch?.trade || "painting",
    scopeType: patch?.scopeType || null,
    effectiveSqft: toNumOrNull(draftPlan.effectiveSqft) || null,
  };

  const summaryText =
    language === "es"
      ? `Borrador AI: ${planMeta.trade} ${planMeta.scopeType || ""} — ${planMeta.effectiveSqft || ""} sqft aprox.`
      : `AI draft: ${planMeta.trade} ${planMeta.scopeType || ""} — ~${planMeta.effectiveSqft || ""} sqft.`;

  return {
    meta: planMeta,
    summaryText,
    laborLines,
    materialLines,
    notes: Array.isArray(draftPlan.notes) ? draftPlan.notes : [],
  };
}

async function llmFallback(message, state, lang, missingHint) {
  const language = lang === "es" ? "es" : "en";

  const system = `You extract estimate fields for PAINTING.
Return ONLY JSON with exact shape:
{"patch":{"trade":"painting","scopeType":null,"scopeBasis":null,"rooms":null,"sqft":null,"stories":null,"ceilingHeightFt":null,"coats":null,"prep":null,"includeCeilings":null,"includeTrimDoors":null,"needForeman":null}}
No other keys. rooms must be a NUMBER or null (never array/object).`;

  const prompt = `${system}
Lang:${language}
Missing:${JSON.stringify(missingHint || [])}
Current:${JSON.stringify(state || {})}
User:${String(message || "")}
`;
  try {
    const r = await fetchWithTimeout(`${OLLAMA_BASE}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      prompt,
      format: "json",
      stream: false,
      keep_alive: "10m",
      options: { temperature: 0, num_predict: 70, num_ctx: 512 },
      stop: ["\n\n"],
    }),
  }, OLLAMA_TIMEOUT_MS);

    if (!r.ok) return null;
  const data = await r.json();
  const raw = String(data?.response || "").trim();
  const parsed = extractJsonPayload(raw);
  if (!parsed || typeof parsed !== "object") return null;

  const patch = sanitizeState(parsed.patch || parsed);
  return { patch, _raw: raw };
  } catch (e) {
    return null;
  }
}

app.post("/api/ai-draft", async (req, res) => {
  try {
    const { message, state, lang } = req.body || {};
    const userMsg = String(message || "").trim();
    if (!userMsg) return res.status(400).json({ error: "Missing message" });

    let current = sanitizeState(state || {});

    // Conversational onboarding: if user is vague and we have no scope yet, don't interrogate.
    if (!current.scopeType && isVagueStarterMessage(userMsg)) {
      return res.json({
        patch: current,
        missing: ["scopeType"],
        nextQuestion: humanAsk("scopeType", current, lang),
        draftPlan: null,
        fpeDraft: null,
      });
    }
    // RULE PARSER DISABLED (LLM-FIRST)
    // Guardrails (pre) just to provide missing-hints to the model for short replies like "2"
    let pre = applyGuardrailsAndNextQuestion(current, lang);

    // LLM FIRST (always run). No conditional gating.
    let rawLLM = null;
    const llm = await llmFallback(userMsg, current, lang, pre.missing);
    if (llm && llm.patch) {
      rawLLM = llm._raw || null;
      current = mergePatch(current, llm.patch);
    }

    let guarded = applyGuardrailsAndNextQuestion(current, lang);

    // If user says "not sure / idk", we can apply a safe default for certain fields and keep the convo moving.
    if (isUnsure(userMsg) && guarded.missing && guarded.missing.length === 1) {
      const mk = guarded.missing[0];
      const applied = applyUnsureDefault(guarded.state, mk, lang);
      if (applied.applied) {
        current = applied.state;
        guarded = applyGuardrailsAndNextQuestion(current, lang);
      }
    }

    let draftPlan = null;
    if (guarded.missing.length === 0 && guarded.nextQuestion === "") {
      draftPlan = computePaintingDraftPlan(guarded.state);
    }

// Human acknowledgements: detect one newly-filled key (null -> value) this turn.
let filledKey = "";
let filledVal = null;
try {
  const prev = sanitizeState(state || {});
  const nowS = sanitizeState(guarded.state || {});
  const keys = Object.keys(nowS);
  for (const k of keys) {
    const wasEmpty = prev[k] === null || prev[k] === undefined || prev[k] === "";
    const isSet = nowS[k] !== null && nowS[k] !== undefined && nowS[k] !== "";
    if (wasEmpty && isSet) { filledKey = k; filledVal = nowS[k]; break; }
  }
} catch {
  // ignore
}


    return res.json({
      patch: guarded.state,
      missing: guarded.missing,
      nextQuestion: soften(withAck(guarded.nextQuestion, filledKey, filledVal, lang), lang),
      status: oneLinerStatus(guarded.state, lang),
      draftPlan,
    fpeDraft: draftPlan ? planToFpeDraft(draftPlan, guarded.state, lang) : null,
      ...(rawLLM ? { _raw: rawLLM } : {}),
    });
  } catch (e) {
    const msg = String(e?.message || e);
    if (msg.includes("aborted")) return res.status(504).json({ error: "Timeout waiting for Ollama" });
    return res.status(500).json({ error: "ai-draft failed", detail: msg });
  }
});

app.get("/", (req, res) => res.send("OK"));

app.get("/health", (req, res) => {
  res.status(200).json({ ok: true, v: "v16", ts: Date.now() });
});

app.post("/api/translate", async (req, res) => {
  try {
    const { text, target } = req.body || {};
    const t = String(text || "").trim();
    const lang = String(target || "en").toLowerCase().startsWith("es") ? "Spanish" : "English";
    if (!t) return res.status(400).json({ error: "Missing text" });

    // Ollama translate prompt (fast + deterministic)
    const prompt = `Translate the following into ${lang}. Return ONLY the translated text.\n\nTEXT:\n${t}`;

    const r = await fetchWithTimeout(
      `${OLLAMA_BASE}/api/generate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: MODEL,
          prompt,
          stream: false,
        }),
      },
      OLLAMA_TIMEOUT_MS
    );

    if (!r.ok) {
      const errText = await r.text().catch(() => "");
      return res.status(500).json({ error: "Ollama error", status: r.status, detail: errText });
    }

    const data = await r.json();
    const translatedText = String(data?.response || "").trim();

    return res.json({ translatedText });
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
});

app.listen(5055, () => {
  console.log("Dev AI server running on http://localhost:5055");
});
