import { STORAGE_KEYS } from "./constants/storageKeys";
import { ROUTES } from "./constants/routes";

const PROJECT_CREATE_SEED_KEY = "estipaid-project-create-seed-v1";
const PROJECT_DETAIL_RETURN_TARGET_KEY = "estipaid-project-detail-return-target-v1";

function createProject(overrides = {}) {
  return {
    id: "proj_test",
    projectName: "Test Project",
    ...overrides,
  };
}

function createCustomer(overrides = {}) {
  return {
    id: "cust_test",
    fullName: "Test Customer",
    ...overrides,
  };
}

function seedProjectCreateSeed(seed) {
  localStorage.setItem(PROJECT_CREATE_SEED_KEY, JSON.stringify(seed));
}

function seedProjectDetailReturnTarget(target) {
  localStorage.setItem(PROJECT_DETAIL_RETURN_TARGET_KEY, JSON.stringify(target));
}

function seedProjects(projects) {
  localStorage.setItem(STORAGE_KEYS.PROJECTS, JSON.stringify(projects));
}

function seedCustomers(customers) {
  localStorage.setItem(STORAGE_KEYS.CUSTOMERS, JSON.stringify(customers));
}

function readProjectCreateSeed() {
  return localStorage.getItem(PROJECT_CREATE_SEED_KEY);
}

describe("EstimateForm PROJECT_CREATE_SEED validation setup", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  test("seed storage can be set up with valid project and customer", () => {
    const project = createProject({ id: "proj_valid" });
    const customer = createCustomer({ id: "cust_valid" });
    seedProjects([project]);
    seedCustomers([customer]);
    seedProjectDetailReturnTarget({
      route: ROUTES.PROJECT_DETAIL,
      projectId: "proj_valid",
    });
    seedProjectCreateSeed({
      projectId: "proj_valid",
      customerId: "cust_valid",
      projectName: "Test Project",
      customerName: "Test Customer",
    });

    expect(localStorage.getItem(STORAGE_KEYS.PROJECTS)).toContain("proj_valid");
    expect(localStorage.getItem(STORAGE_KEYS.CUSTOMERS)).toContain("cust_valid");
    expect(readProjectCreateSeed()).toContain("proj_valid");
    expect(readProjectCreateSeed()).toContain("cust_valid");
  });

  test("seed storage can be set up with missing return target", () => {
    const project = createProject({ id: "proj_test" });
    const customer = createCustomer({ id: "cust_test" });
    seedProjects([project]);
    seedCustomers([customer]);
    seedProjectCreateSeed({
      projectId: "proj_test",
      customerId: "cust_test",
      projectName: "Test Project",
      customerName: "Test Customer",
    });

    expect(readProjectCreateSeed()).not.toBeNull();
    expect(localStorage.getItem(PROJECT_DETAIL_RETURN_TARGET_KEY)).toBeNull();
  });

  test("seed storage can be set up with stale project", () => {
    const customer = createCustomer({ id: "cust_test" });
    seedProjects([]);
    seedCustomers([customer]);
    seedProjectDetailReturnTarget({
      route: ROUTES.PROJECT_DETAIL,
      projectId: "proj_deleted",
    });
    seedProjectCreateSeed({
      projectId: "proj_deleted",
      customerId: "cust_test",
      projectName: "Deleted Project",
      customerName: "Test Customer",
    });

    expect(readProjectCreateSeed()).toContain("proj_deleted");
    expect(localStorage.getItem(STORAGE_KEYS.PROJECTS)).toBe("[]");
  });

  test("seed storage can be set up with stale customer", () => {
    const project = createProject({ id: "proj_test" });
    seedProjects([project]);
    seedCustomers([]);
    seedProjectDetailReturnTarget({
      route: ROUTES.PROJECT_DETAIL,
      projectId: "proj_test",
    });
    seedProjectCreateSeed({
      projectId: "proj_test",
      customerId: "cust_deleted",
      projectName: "Test Project",
      customerName: "Deleted Customer",
    });

    expect(readProjectCreateSeed()).toContain("cust_deleted");
    expect(localStorage.getItem(STORAGE_KEYS.CUSTOMERS)).toBe("[]");
  });

  test("EstimateForm module can be imported without error", async () => {
    const { default: EstimateForm } = await import("./EstimateForm.js");
    expect(EstimateForm).toBeDefined();
  });
});
