import { renderHook, waitFor } from "@testing-library/react";

const mockGetSupabaseClient = jest.fn();

jest.mock("./supabaseClient", () => ({
  getSupabaseClient: (...args) => mockGetSupabaseClient(...args),
}));

const useSupabaseAccount = require("./useSupabaseAccount").default;

function createQueryChain(response, options = {}) {
  const maybeSingle = jest.fn(async () => response);
  const chain = {
    select: jest.fn(() => chain),
    eq: jest.fn(() => chain),
    maybeSingle,
  };
  if (options.includeLimit !== false) {
    chain.limit = jest.fn(() => chain);
  }
  return chain;
}

function createMockClient({ membershipResponse, companyResponse }) {
  const membershipChain = createQueryChain(membershipResponse);
  const companyChain = createQueryChain(companyResponse, { includeLimit: false });
  const from = jest.fn((table) => {
    if (table === "company_users") return membershipChain;
    if (table === "companies") return companyChain;
    throw new Error(`Unexpected table: ${table}`);
  });
  return {
    client: { from },
    membershipChain,
    companyChain,
  };
}

describe("useSupabaseAccount", () => {
  beforeEach(() => {
    mockGetSupabaseClient.mockReset();
    mockGetSupabaseClient.mockReturnValue(null);
  });

  test("does not query when signed out or unconfigured", async () => {
    const { result } = renderHook(() => useSupabaseAccount({
      configured: false,
      user: null,
    }));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(mockGetSupabaseClient).toHaveBeenCalledTimes(1);
    expect(result.current.companyUser).toBeNull();
    expect(result.current.company).toBeNull();
    expect(result.current.hasCompany).toBe(false);
    expect(result.current.error).toBe("");
  });

  test("loads existing company membership and company record read-only", async () => {
    const mock = createMockClient({
      membershipResponse: {
        data: { id: "membership_1", user_id: "user_1", company_id: "company_1", role: "owner" },
        error: null,
      },
      companyResponse: {
        data: { id: "company_1", name: "Field Pocket LLC" },
        error: null,
      },
    });
    mockGetSupabaseClient.mockReturnValue(mock.client);

    const { result } = renderHook(() => useSupabaseAccount({
      configured: true,
      user: { id: "user_1", email: "owner@example.com" },
    }));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.hasCompany).toBe(true);
    });

    const queriedTables = mock.client.from.mock.calls.map(([table]) => table);
    expect(queriedTables).toContain("company_users");
    expect(queriedTables).toContain("companies");
    expect(mock.membershipChain.select).toHaveBeenCalledWith("*");
    expect(mock.membershipChain.eq).toHaveBeenCalledWith("user_id", "user_1");
    expect(mock.membershipChain.limit).toHaveBeenCalledWith(1);
    expect(mock.companyChain.eq).toHaveBeenCalledWith("id", "company_1");
    expect(result.current.companyUser).toEqual(expect.objectContaining({
      company_id: "company_1",
      role: "owner",
    }));
    expect(result.current.company).toEqual(expect.objectContaining({
      id: "company_1",
      name: "Field Pocket LLC",
    }));
    expect(result.current.role).toBe("owner");
  });

  test("reports no membership without querying companies", async () => {
    const mock = createMockClient({
      membershipResponse: { data: null, error: null },
      companyResponse: { data: null, error: null },
    });
    mockGetSupabaseClient.mockReturnValue(mock.client);

    const { result } = renderHook(() => useSupabaseAccount({
      configured: true,
      user: { id: "user_2" },
    }));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const queriedTables = mock.client.from.mock.calls.map(([table]) => table);
    expect(queriedTables).toContain("company_users");
    expect(queriedTables).not.toContain("companies");
    expect(result.current.companyUser).toBeNull();
    expect(result.current.company).toBeNull();
    expect(result.current.hasCompany).toBe(false);
    expect(result.current.error).toBe("");
  });

  test("fails safely when company lookup errors", async () => {
    const mock = createMockClient({
      membershipResponse: {
        data: { id: "membership_1", user_id: "user_3", company_id: "company_missing", role: "member" },
        error: null,
      },
      companyResponse: {
        data: null,
        error: { message: "permission denied" },
      },
    });
    mockGetSupabaseClient.mockReturnValue(mock.client);

    const { result } = renderHook(() => useSupabaseAccount({
      configured: true,
      user: { id: "user_3" },
    }));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.companyUser).toEqual(expect.objectContaining({
      company_id: "company_missing",
      role: "member",
    }));
    expect(result.current.role).toBe("member");
    expect(result.current.company).toBeNull();
    expect(result.current.hasCompany).toBe(false);
    expect(result.current.error).toBe("Unable to load company status.");
  });
});
