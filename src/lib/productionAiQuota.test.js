/** @jest-environment node */

const {
  AI_ASSIST_QUOTA_ROUTE,
  AI_QUOTA_LIMITS,
  GUIDED_BUILD_QUOTA_ROUTE,
  PAID_AI_BUDGET,
  QUOTA_CONSUME_FUNCTION,
  QUOTA_ENFORCED_ROUTES,
  authorizeProductionAiQuota,
  consumeProductionAiQuota,
  isQuotaEnforcedRoute,
  normalizeRetryAfterSeconds,
  resolveActiveCompanyMembership,
} = require("../../server/productionAiQuota");

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const COMPANY_A = "33333333-3333-4333-8333-333333333333";
const USER_C = "55555555-5555-4555-8555-555555555555";
const COMPANY_B = "44444444-4444-4444-8444-444444444444";

const SHORT_MS = AI_QUOTA_LIMITS.shortWindowSeconds * 1000;
const DAY_MS = AI_QUOTA_LIMITS.dailyWindowSeconds * 1000;

// Faithful in-memory model of docs/supabase-security-r2-ai-quota-v1.sql. Every
// call is serialized through a promise chain, standing in for the FOR UPDATE
// row locks: check-and-increment is indivisible, and a denial increments
// nothing.
function createQuotaStore({ clock, limits = AI_QUOTA_LIMITS } = {}) {
  const counters = new Map();
  let lock = Promise.resolve();

  function bucketsFor(now) {
    return {
      short: Math.floor(now / SHORT_MS) * SHORT_MS,
      daily: Math.floor(now / DAY_MS) * DAY_MS,
    };
  }

  function key(subjectType, subjectId, budget, windowKind, bucket) {
    return [subjectType, subjectId, budget, windowKind, bucket].join("|");
  }

  function consume(args) {
    const now = clock.now();
    const bucket = bucketsFor(now);
    const budget = args.p_budget;

    // Retention: expired buckets for these subjects never survive a call. Each
    // subject id matches only inside its own namespace.
    [...counters.keys()].forEach((existing) => {
      const [subjectType, subjectId, storedBudget, windowKind, storedBucket] = existing.split("|");
      if (storedBudget !== budget) return;
      const owner = subjectType === "user" ? args.p_user_id : args.p_company_id;
      if (subjectId !== owner) return;
      const live = windowKind === "short" ? bucket.short : bucket.daily;
      if (Number(storedBucket) < live) counters.delete(existing);
    });

    const slots = [
      ["company", args.p_company_id, "short", bucket.short, args.p_company_short_limit],
      ["company", args.p_company_id, "daily", bucket.daily, args.p_company_daily_limit],
      ["user", args.p_user_id, "short", bucket.short, args.p_user_short_limit],
      ["user", args.p_user_id, "daily", bucket.daily, args.p_user_daily_limit],
    ].map(([subjectType, subjectId, windowKind, bucketStart, limit]) => ({
      key: key(subjectType, subjectId, budget, windowKind, bucketStart),
      windowKind,
      bucketStart,
      limit,
    }));

    slots.forEach((slot) => {
      if (!counters.has(slot.key)) counters.set(slot.key, 0);
    });

    const exhausted = slots.find((slot) => counters.get(slot.key) >= slot.limit);
    if (exhausted) {
      const endsAt = exhausted.windowKind === "short"
        ? exhausted.bucketStart + SHORT_MS
        : exhausted.bucketStart + DAY_MS;
      return {
        data: [{ allowed: false, retry_after_seconds: Math.max(1, Math.ceil((endsAt - now) / 1000)) }],
        error: null,
      };
    }

    slots.forEach((slot) => counters.set(slot.key, counters.get(slot.key) + 1));
    return { data: [{ allowed: true, retry_after_seconds: 0 }], error: null };
  }

  return {
    counters,
    rpc: jest.fn((name, args) => {
      lock = lock.then(async () => {
        // Yield inside the critical section: a caller that read a count before
        // this point and incremented after would double-admit.
        await Promise.resolve();
        return consume(args);
      });
      return lock;
    }),
    limits,
  };
}

function createClient({ membershipRows = [{ company_id: COMPANY_A }], membershipError = null, store } = {}) {
  const from = jest.fn(() => {
    const builder = {
      select: () => builder,
      eq: () => builder,
      then: (resolve, reject) =>
        Promise.resolve({ data: membershipError ? null : membershipRows, error: membershipError }).then(resolve, reject),
    };
    return builder;
  });
  return { from, rpc: store ? store.rpc : jest.fn(), _store: store, _from: from };
}

function fixedClock(startMs = Date.UTC(2026, 6, 18, 12, 0, 0)) {
  let current = startMs;
  return { now: () => current, advance: (ms) => { current += ms; } };
}

async function admit(client, { userId = USER_A, route = AI_ASSIST_QUOTA_ROUTE } = {}) {
  return authorizeProductionAiQuota({ client, userId, route });
}

describe("R2.2 route enrollment", () => {
  test("enrolls every paid AI route", () => {
    expect([...QUOTA_ENFORCED_ROUTES].sort()).toEqual([AI_ASSIST_QUOTA_ROUTE, GUIDED_BUILD_QUOTA_ROUTE].sort());
    expect(isQuotaEnforcedRoute(AI_ASSIST_QUOTA_ROUTE)).toBe(true);
    // A dormant UI does not make a deployed endpoint unreachable.
    expect(isQuotaEnforcedRoute(GUIDED_BUILD_QUOTA_ROUTE)).toBe(true);
    expect(isQuotaEnforcedRoute("/api/translate")).toBe(false);
    expect(isQuotaEnforcedRoute("")).toBe(false);
  });

  test("keeps conservative centralized limits that the browser cannot reach", () => {
    expect(AI_QUOTA_LIMITS.userShortWindow).toBeLessThanOrEqual(AI_QUOTA_LIMITS.companyShortWindow);
    expect(AI_QUOTA_LIMITS.userDaily).toBeLessThanOrEqual(AI_QUOTA_LIMITS.companyDaily);
    expect(Object.isFrozen(AI_QUOTA_LIMITS)).toBe(true);
  });
});

describe("Authoritative company membership resolution", () => {
  test("resolves the single active membership from the database", async () => {
    const client = createClient();
    const result = await resolveActiveCompanyMembership({ client, userId: USER_A });
    expect(result).toEqual({ ok: true, companyId: COMPANY_A });
    expect(client._from).toHaveBeenCalledWith("company_users");
  });

  test("denies a user with no active membership", async () => {
    const result = await resolveActiveCompanyMembership({ client: createClient({ membershipRows: [] }), userId: USER_A });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
  });

  test("denies multiple active memberships deterministically", async () => {
    const client = createClient({ membershipRows: [{ company_id: COMPANY_A }, { company_id: COMPANY_B }] });
    const first = await resolveActiveCompanyMembership({ client, userId: USER_A });
    const second = await resolveActiveCompanyMembership({ client, userId: USER_A });
    expect(first).toEqual(second);
    expect(first.ok).toBe(false);
    expect(first.status).toBe(403);
    expect(JSON.stringify(first)).not.toContain(COMPANY_A);
  });

  test("denies a malformed membership row", async () => {
    const client = createClient({ membershipRows: [{ company_id: "not-a-uuid" }] });
    const result = await resolveActiveCompanyMembership({ client, userId: USER_A });
    expect(result).toMatchObject({ ok: false, status: 403 });
  });

  test("fails closed with 503 when the membership lookup errors or is malformed", async () => {
    const errored = await resolveActiveCompanyMembership({
      client: createClient({ membershipError: { message: "relation does not exist" } }),
      userId: USER_A,
    });
    expect(errored).toMatchObject({ ok: false, status: 503 });
    expect(JSON.stringify(errored)).not.toMatch(/relation|does not exist/i);

    const malformed = await resolveActiveCompanyMembership({
      client: createClient({ membershipRows: "unexpected" }),
      userId: USER_A,
    });
    expect(malformed).toMatchObject({ ok: false, status: 503 });
  });

  test("rejects a non-authenticated user id without touching the database", async () => {
    const client = createClient();
    const result = await resolveActiveCompanyMembership({ client, userId: "" });
    expect(result).toMatchObject({ ok: false, status: 403 });
    expect(client._from).not.toHaveBeenCalled();
  });
});

describe("Durable quota consumption", () => {
  test("sends only server-side identity and centralized limits to the quota authority", async () => {
    const store = createQuotaStore({ clock: fixedClock() });
    const client = createClient({ store });
    await admit(client);
    expect(store.rpc).toHaveBeenCalledWith(QUOTA_CONSUME_FUNCTION, {
      p_user_id: USER_A,
      p_company_id: COMPANY_A,
      p_budget: PAID_AI_BUDGET,
      p_user_short_limit: AI_QUOTA_LIMITS.userShortWindow,
      p_company_short_limit: AI_QUOTA_LIMITS.companyShortWindow,
      p_user_daily_limit: AI_QUOTA_LIMITS.userDaily,
      p_company_daily_limit: AI_QUOTA_LIMITS.companyDaily,
    });
  });

  test("exhausts the per-user short window and returns 429 with a valid Retry-After", async () => {
    const clock = fixedClock();
    const store = createQuotaStore({ clock });
    const client = createClient({ store });

    for (let i = 0; i < AI_QUOTA_LIMITS.userShortWindow; i += 1) {
      expect((await admit(client)).ok).toBe(true);
    }
    const denial = await admit(client);
    expect(denial).toMatchObject({ ok: false, status: 429 });

    const retryAfter = Number(denial.headers["Retry-After"]);
    expect(Number.isInteger(retryAfter)).toBe(true);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(AI_QUOTA_LIMITS.shortWindowSeconds);
  });

  test("admits again after the short bucket rolls over", async () => {
    const clock = fixedClock();
    const store = createQuotaStore({ clock });
    const client = createClient({ store });

    for (let i = 0; i < AI_QUOTA_LIMITS.userShortWindow; i += 1) await admit(client);
    expect((await admit(client)).status).toBe(429);

    clock.advance(SHORT_MS);
    expect((await admit(client)).ok).toBe(true);
  });

  test("exhausts the per-company short window across different users", async () => {
    const clock = fixedClock();
    const store = createQuotaStore({ clock });
    // Both users belong to the same company.
    const client = createClient({ store });

    // Round-robin across enough users that the company limit -- not any single
    // user's limit -- is what finally bites.
    const users = [USER_A, USER_B, USER_C];
    let admitted = 0;
    for (let i = 0; i < AI_QUOTA_LIMITS.companyShortWindow * 2; i += 1) {
      const result = await admit(client, { userId: users[i % users.length] });
      if (result.ok) admitted += 1;
      else expect(result.status).toBe(429);
    }
    expect(admitted).toBe(AI_QUOTA_LIMITS.companyShortWindow);
  });

  test("enforces the daily per-user limit across many short buckets", async () => {
    const clock = fixedClock(Date.UTC(2026, 6, 18, 0, 0, 0));
    const store = createQuotaStore({ clock });
    const client = createClient({ store });

    let admitted = 0;
    let lastDenial = null;
    // Roll the short window every batch so only the daily limit can bite.
    while (admitted < AI_QUOTA_LIMITS.userDaily + 1) {
      const result = await admit(client);
      if (result.ok) admitted += 1;
      else { lastDenial = result; break; }
      clock.advance(SHORT_MS);
    }
    expect(admitted).toBe(AI_QUOTA_LIMITS.userDaily);
    expect(lastDenial).toMatchObject({ ok: false, status: 429 });
    expect(Number(lastDenial.headers["Retry-After"])).toBeGreaterThan(AI_QUOTA_LIMITS.shortWindowSeconds);
  });

  test("enforces the daily per-company limit across different users", async () => {
    const clock = fixedClock(Date.UTC(2026, 6, 18, 0, 0, 0));
    const store = createQuotaStore({ clock });
    const client = createClient({ store });

    const users = [USER_A, USER_B, USER_C];
    let admitted = 0;
    let denied = 0;
    for (let i = 0; i < AI_QUOTA_LIMITS.companyDaily + 5; i += 1) {
      const result = await admit(client, { userId: users[i % users.length] });
      if (result.ok) admitted += 1; else denied += 1;
      clock.advance(SHORT_MS);
    }
    expect(admitted).toBe(AI_QUOTA_LIMITS.companyDaily);
    expect(denied).toBeGreaterThan(0);
  });

  test("keeps separate counters for separate users and separate companies", async () => {
    const clock = fixedClock();
    const store = createQuotaStore({ clock });
    const companyA = createClient({ store });
    const companyB = createClient({ store, membershipRows: [{ company_id: COMPANY_B }] });

    for (let i = 0; i < AI_QUOTA_LIMITS.userShortWindow; i += 1) await admit(companyA, { userId: USER_A });
    expect((await admit(companyA, { userId: USER_A })).status).toBe(429);

    // A different user in the same company still has its own user bucket.
    expect((await admit(companyA, { userId: USER_B })).ok).toBe(true);
    // A different company is entirely independent.
    expect((await admit(companyB, { userId: USER_B })).ok).toBe(true);
  });

  test("concurrent consumption cannot exceed the per-user limit", async () => {
    const clock = fixedClock();
    const store = createQuotaStore({ clock });
    const client = createClient({ store });

    const attempts = AI_QUOTA_LIMITS.userShortWindow * 3;
    const results = await Promise.all(Array.from({ length: attempts }, () => admit(client)));
    const admitted = results.filter((result) => result.ok).length;

    expect(admitted).toBe(AI_QUOTA_LIMITS.userShortWindow);
    results.filter((result) => !result.ok).forEach((result) => expect(result.status).toBe(429));
  });

  test("returns 503 when the quota authority is unreachable or errors", async () => {
    const throwing = createClient();
    throwing.rpc = jest.fn(async () => { throw new Error("ECONNRESET at db.internal"); });
    const thrown = await admit(throwing);
    expect(thrown).toMatchObject({ ok: false, status: 503 });
    expect(JSON.stringify(thrown)).not.toMatch(/ECONNRESET|db\.internal/);

    const errored = createClient();
    errored.rpc = jest.fn(async () => ({ data: null, error: { message: 'function "consume_ai_route_quota" does not exist' } }));
    const errorResult = await admit(errored);
    expect(errorResult).toMatchObject({ ok: false, status: 503 });
    expect(JSON.stringify(errorResult)).not.toMatch(/consume_ai_route_quota|does not exist/);
  });

  test.each([
    ["null data", { data: null, error: null }],
    ["empty rows", { data: [], error: null }],
    ["non-boolean allowed", { data: [{ allowed: "yes", retry_after_seconds: 30 }], error: null }],
    ["missing allowed", { data: [{ retry_after_seconds: 30 }], error: null }],
    ["denial without retry", { data: [{ allowed: false, retry_after_seconds: null }], error: null }],
    ["denial with zero retry", { data: [{ allowed: false, retry_after_seconds: 0 }], error: null }],
    ["denial with garbage retry", { data: [{ allowed: false, retry_after_seconds: "soon" }], error: null }],
    ["scalar row", { data: "allowed", error: null }],
  ])("returns 503 for a malformed quota result (%s)", async (_name, response) => {
    const client = createClient();
    client.rpc = jest.fn(async () => response);
    expect(await admit(client)).toMatchObject({ ok: false, status: 503 });
  });

  test("never consumes quota when membership resolution fails", async () => {
    const store = createQuotaStore({ clock: fixedClock() });
    const client = createClient({ store, membershipRows: [] });
    expect((await admit(client)).status).toBe(403);
    expect(store.rpc).not.toHaveBeenCalled();
    expect(store.counters.size).toBe(0);
  });

  test("refuses to consume quota for a route that is not enrolled", async () => {
    const store = createQuotaStore({ clock: fixedClock() });
    const client = createClient({ store });
    const result = await consumeProductionAiQuota({
      client, userId: USER_A, companyId: COMPANY_A, route: "/api/translate",
    });
    expect(result).toMatchObject({ ok: false, status: 503 });
    expect(store.rpc).not.toHaveBeenCalled();
  });

  test("persists no token, prompt, customer text, estimate content or AI response", async () => {
    const store = createQuotaStore({ clock: fixedClock() });
    const client = createClient({ store });
    await admit(client);

    const persisted = JSON.stringify([...store.counters.entries()]);
    ["Bearer", "token", "prompt", "customer", "estimate", "groq"].forEach((secret) => {
      expect(persisted.toLowerCase()).not.toContain(secret.toLowerCase());
    });
    // Only identifiers, bucket timestamps and counters are ever recorded --
    // and never the route the caller used.
    [...store.counters.keys()].forEach((recorded) => {
      const [subjectType, subjectId, budget, windowKind, bucket] = recorded.split("|");
      expect(["user", "company"]).toContain(subjectType);
      expect([USER_A, USER_B, USER_C, COMPANY_A, COMPANY_B]).toContain(subjectId);
      expect(budget).toBe(PAID_AI_BUDGET);
      expect(["short", "daily"]).toContain(windowKind);
      expect(Number.isFinite(Number(bucket))).toBe(true);
    });
    expect(persisted).not.toContain("/api/");

    const args = store.rpc.mock.calls[0][1];
    expect(Object.keys(args).sort()).toEqual([
      "p_budget", "p_company_daily_limit", "p_company_id", "p_company_short_limit",
      "p_user_daily_limit", "p_user_id", "p_user_short_limit",
    ]);
  });

  test("does not disclose usage, limits or internals in a denial", async () => {
    const clock = fixedClock();
    const store = createQuotaStore({ clock });
    const client = createClient({ store });
    for (let i = 0; i < AI_QUOTA_LIMITS.userShortWindow; i += 1) await admit(client);

    const denial = await admit(client);
    const serialized = JSON.stringify(denial);
    expect(serialized).not.toMatch(/consume_ai_route_quota|ai_route_quota_counters|service_role|company_users/);
    expect(serialized).not.toContain(COMPANY_A);
    expect(serialized).not.toContain(String(AI_QUOTA_LIMITS.companyShortWindow));
    expect(denial.error).toBe("AI assistance limit reached. Please try again later.");
  });
});

describe("Shared paid-AI budget across both routes", () => {
  test("both paid routes send the same budget and never the route", async () => {
    const store = createQuotaStore({ clock: fixedClock() });
    const client = createClient({ store });
    await admit(client, { route: AI_ASSIST_QUOTA_ROUTE });
    await admit(client, { route: GUIDED_BUILD_QUOTA_ROUTE });

    const budgets = store.rpc.mock.calls.map(([, args]) => args.p_budget);
    expect(budgets).toEqual([PAID_AI_BUDGET, PAID_AI_BUDGET]);
    store.rpc.mock.calls.forEach(([, args]) => {
      expect(JSON.stringify(args)).not.toContain("/api/");
    });
  });

  test("both paid routes increment the same counter rows", async () => {
    const store = createQuotaStore({ clock: fixedClock() });
    const client = createClient({ store });

    await admit(client, { route: AI_ASSIST_QUOTA_ROUTE });
    const afterFirst = [...store.counters.keys()].sort();
    await admit(client, { route: GUIDED_BUILD_QUOTA_ROUTE });

    // Enrolling a second route creates no second set of counters.
    expect([...store.counters.keys()].sort()).toEqual(afterFirst);
    expect(store.counters.size).toBe(4);
    [...store.counters.values()].forEach((count) => expect(count).toBe(2));
  });

  test("traffic split across both routes cannot exceed one shared user allowance", async () => {
    const clock = fixedClock();
    const store = createQuotaStore({ clock });
    const client = createClient({ store });

    // Alternate endpoints. A per-route allowance would admit twice the limit.
    const routes = [AI_ASSIST_QUOTA_ROUTE, GUIDED_BUILD_QUOTA_ROUTE];
    const results = [];
    for (let i = 0; i < AI_QUOTA_LIMITS.userShortWindow * 2 + 4; i += 1) {
      results.push(await admit(client, { route: routes[i % routes.length] }));
    }

    expect(results.filter((result) => result.ok)).toHaveLength(AI_QUOTA_LIMITS.userShortWindow);
    results.filter((result) => !result.ok).forEach((result) => expect(result.status).toBe(429));

    // The route the caller switches to after exhaustion is also refused.
    expect((await admit(client, { route: GUIDED_BUILD_QUOTA_ROUTE })).status).toBe(429);
    expect((await admit(client, { route: AI_ASSIST_QUOTA_ROUTE })).status).toBe(429);
  });

  test("traffic split across both routes cannot exceed one shared company allowance", async () => {
    const clock = fixedClock();
    const store = createQuotaStore({ clock });
    const client = createClient({ store });

    const users = [USER_A, USER_B, USER_C];
    const routes = [AI_ASSIST_QUOTA_ROUTE, GUIDED_BUILD_QUOTA_ROUTE];
    let admitted = 0;
    for (let i = 0; i < AI_QUOTA_LIMITS.companyShortWindow * 2 + 4; i += 1) {
      const result = await admit(client, { userId: users[i % users.length], route: routes[i % routes.length] });
      if (result.ok) admitted += 1;
      else expect(result.status).toBe(429);
    }
    expect(admitted).toBe(AI_QUOTA_LIMITS.companyShortWindow);
  });

  test("exhausting one route immediately exhausts the other", async () => {
    const clock = fixedClock();
    const store = createQuotaStore({ clock });
    const client = createClient({ store });

    for (let i = 0; i < AI_QUOTA_LIMITS.userShortWindow; i += 1) {
      expect((await admit(client, { route: GUIDED_BUILD_QUOTA_ROUTE })).ok).toBe(true);
    }
    const denial = await admit(client, { route: AI_ASSIST_QUOTA_ROUTE });
    expect(denial).toMatchObject({ ok: false, status: 429 });
    expect(Number(denial.headers["Retry-After"])).toBeGreaterThan(0);

    // The shared budget still rolls over as one budget.
    clock.advance(SHORT_MS);
    expect((await admit(client, { route: AI_ASSIST_QUOTA_ROUTE })).ok).toBe(true);
  });

  test("concurrent traffic split across both routes cannot exceed the shared limit", async () => {
    const store = createQuotaStore({ clock: fixedClock() });
    const client = createClient({ store });

    const routes = [AI_ASSIST_QUOTA_ROUTE, GUIDED_BUILD_QUOTA_ROUTE];
    const results = await Promise.all(
      Array.from({ length: AI_QUOTA_LIMITS.userShortWindow * 4 }, (_unused, i) =>
        admit(client, { route: routes[i % routes.length] })
      )
    );
    expect(results.filter((result) => result.ok)).toHaveLength(AI_QUOTA_LIMITS.userShortWindow);
  });

  test("a denial on either route stays generic and discloses no route or internals", async () => {
    const clock = fixedClock();
    const store = createQuotaStore({ clock });
    const client = createClient({ store });
    for (let i = 0; i < AI_QUOTA_LIMITS.userShortWindow; i += 1) await admit(client);

    for (const route of [AI_ASSIST_QUOTA_ROUTE, GUIDED_BUILD_QUOTA_ROUTE]) {
      const denial = await admit(client, { route });
      expect(denial.error).toBe("AI assistance limit reached. Please try again later.");
      const serialized = JSON.stringify(denial);
      expect(serialized).not.toContain("/api/");
      expect(serialized).not.toMatch(/consume_ai_route_quota|ai_route_quota_counters|service_role|paid_ai/);
    }
  });
});

describe("Retry-After normalization", () => {
  test.each([
    [1, 1],
    [30, 30],
    [0.2, 1],
    [59.4, 60],
    [AI_QUOTA_LIMITS.dailyWindowSeconds * 5, AI_QUOTA_LIMITS.dailyWindowSeconds],
  ])("normalizes %p to %p", (input, expected) => {
    expect(normalizeRetryAfterSeconds(input)).toBe(expected);
  });

  test.each([[null], [undefined], ["soon"], [NaN], [0], [-5], [Infinity]])("rejects %p", (input) => {
    expect(normalizeRetryAfterSeconds(input)).toBeNull();
  });
});
