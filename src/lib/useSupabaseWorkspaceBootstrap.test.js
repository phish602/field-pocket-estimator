import { act, renderHook } from "@testing-library/react";

const mockGetSupabaseClient = jest.fn();

jest.mock("./supabaseClient", () => ({
  getSupabaseClient: (...args) => mockGetSupabaseClient(...args),
}));

const useSupabaseWorkspaceBootstrap = require("./useSupabaseWorkspaceBootstrap").default;

function createInsertChain(response) {
  const single = jest.fn(async () => response);
  const select = jest.fn(() => ({ single }));
  const insert = jest.fn(() => ({ select }));
  return { insert, select, single };
}

function createMockClient({ companyResponse, membershipResponse }) {
  const companiesChain = createInsertChain(companyResponse);
  const membershipChain = createInsertChain(membershipResponse);
  const from = jest.fn((table) => {
    if (table === "companies") return companiesChain;
    if (table === "company_users") return membershipChain;
    throw new Error(`Unexpected table: ${table}`);
  });
  return {
    client: { from },
    companiesChain,
    membershipChain,
  };
}

describe("useSupabaseWorkspaceBootstrap", () => {
  beforeEach(() => {
    mockGetSupabaseClient.mockReset();
    mockGetSupabaseClient.mockReturnValue(null);
  });

  test("fails safely when not configured", async () => {
    const { result } = renderHook(() => useSupabaseWorkspaceBootstrap({
      configured: false,
      user: null,
      hasMembership: false,
    }));

    await act(async () => {
      await result.current.createWorkspace("Field Pocket LLC");
    });

    expect(result.current.error).toBe("Supabase not configured.");
  });

  test("validates a non-empty workspace name", async () => {
    const { result } = renderHook(() => useSupabaseWorkspaceBootstrap({
      configured: true,
      user: { id: "user_1" },
      hasMembership: false,
    }));

    await act(async () => {
      await result.current.createWorkspace("   ");
    });

    expect(result.current.error).toBe("Enter a company or workspace name.");
  });

  test("does not create duplicates when membership already exists", async () => {
    const { result } = renderHook(() => useSupabaseWorkspaceBootstrap({
      configured: true,
      user: { id: "user_1" },
      hasMembership: true,
    }));

    await act(async () => {
      await result.current.createWorkspace("Field Pocket LLC");
    });

    expect(result.current.error).toBe("Cloud workspace already exists for this account.");
  });

  test("creates a company and owner membership only", async () => {
    const onCreated = jest.fn();
    const mock = createMockClient({
      companyResponse: {
        data: { id: "company_1", name: "Field Pocket LLC" },
        error: null,
      },
      membershipResponse: {
        data: { id: "membership_1", company_id: "company_1", user_id: "user_1", role: "owner" },
        error: null,
      },
    });
    mockGetSupabaseClient.mockReturnValue(mock.client);

    const { result } = renderHook(() => useSupabaseWorkspaceBootstrap({
      configured: true,
      user: { id: "user_1" },
      hasMembership: false,
      onCreated,
    }));

    await act(async () => {
      await result.current.createWorkspace("Field Pocket LLC");
    });

    expect(mock.client.from.mock.calls.map(([table]) => table)).toEqual(["companies", "company_users"]);
    expect(mock.companiesChain.insert).toHaveBeenCalledWith({
      name: "Field Pocket LLC",
      created_by: "user_1",
      updated_by: "user_1",
    });
    expect(mock.companiesChain.insert.mock.calls[0][0]).not.toHaveProperty("company_name");
    expect(mock.membershipChain.insert).toHaveBeenCalledWith({
      company_id: "company_1",
      user_id: "user_1",
      role: "owner",
      created_by: "user_1",
      updated_by: "user_1",
    });
    expect(result.current.success).toBe("Cloud workspace created: Field Pocket LLC");
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({
      company: expect.objectContaining({ id: "company_1" }),
      membership: expect.objectContaining({ company_id: "company_1", role: "owner" }),
      role: "owner",
    }));
  });

  test("surfaces membership-link failures without crashing", async () => {
    const mock = createMockClient({
      companyResponse: {
        data: { id: "company_1", name: "Field Pocket LLC" },
        error: null,
      },
      membershipResponse: {
        data: null,
        error: { message: "duplicate key value violates unique constraint" },
      },
    });
    mockGetSupabaseClient.mockReturnValue(mock.client);

    const { result } = renderHook(() => useSupabaseWorkspaceBootstrap({
      configured: true,
      user: { id: "user_1" },
      hasMembership: false,
    }));

    await act(async () => {
      await result.current.createWorkspace("Field Pocket LLC");
    });

    expect(result.current.error).toBe("duplicate key value violates unique constraint");
  });
});
