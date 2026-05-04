import { render, screen, waitFor } from "@testing-library/react";
import { STORAGE_KEYS } from "../constants/storageKeys";
import ProjectsScreen from "./ProjectsScreen";

function seedProjects(projects) {
  localStorage.setItem(STORAGE_KEYS.PROJECTS, JSON.stringify(projects));
}

function seedCustomers(customers) {
  localStorage.setItem(STORAGE_KEYS.CUSTOMERS, JSON.stringify(customers));
}

function seedEstimates(estimates) {
  localStorage.setItem(STORAGE_KEYS.ESTIMATES, JSON.stringify(estimates));
}

function seedInvoices(invoices) {
  localStorage.setItem(STORAGE_KEYS.INVOICES, JSON.stringify(invoices));
}

function createProject(overrides = {}) {
  return {
    id: "proj_test",
    projectName: "Test Project",
    customerName: "Test Customer",
    status: "active",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe("ProjectsScreen same-tab refresh", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  test("refreshes immediately when estipaid:projects-changed event fires", async () => {
    const project = createProject({ id: "proj_1", projectName: "Original Project" });
    seedProjects([project]);
    seedCustomers([]);
    seedEstimates([]);
    seedInvoices([]);

    render(<ProjectsScreen onOpenProjectDetail={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText(/Original Project/i)).toBeInTheDocument();
    });

    // Update project name in storage
    const updatedProject = { ...project, projectName: "Updated Project Name" };
    seedProjects([updatedProject]);

    // Dispatch estipaid:projects-changed event
    window.dispatchEvent(new Event("estipaid:projects-changed"));

    // Verify UI refreshes immediately
    await waitFor(() => {
      expect(screen.getByText(/Updated Project Name/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/Original Project/i)).not.toBeInTheDocument();
  });

  test("refreshes when project is added via estipaid:projects-changed event", async () => {
    const project1 = createProject({ id: "proj_1", projectName: "Project One" });
    seedProjects([project1]);
    seedCustomers([]);
    seedEstimates([]);
    seedInvoices([]);

    render(<ProjectsScreen onOpenProjectDetail={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText(/Project One/i)).toBeInTheDocument();
    });

    // Add a second project
    const project2 = createProject({ id: "proj_2", projectName: "Project Two" });
    seedProjects([project1, project2]);

    // Dispatch estipaid:projects-changed event
    window.dispatchEvent(new Event("estipaid:projects-changed"));

    // Verify both projects are visible
    await waitFor(() => {
      expect(screen.getByText(/Project Two/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/Project One/i)).toBeInTheDocument();
  });

  test("refreshes when project is deleted via estipaid:projects-changed event", async () => {
    const project1 = createProject({ id: "proj_1", projectName: "Project One" });
    const project2 = createProject({ id: "proj_2", projectName: "Project Two" });
    seedProjects([project1, project2]);
    seedCustomers([]);
    seedEstimates([]);
    seedInvoices([]);

    render(<ProjectsScreen onOpenProjectDetail={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText(/Project One/i)).toBeInTheDocument();
      expect(screen.getByText(/Project Two/i)).toBeInTheDocument();
    });

    // Remove project2
    seedProjects([project1]);

    // Dispatch estipaid:projects-changed event
    window.dispatchEvent(new Event("estipaid:projects-changed"));

    // Verify project2 is removed
    await waitFor(() => {
      expect(screen.queryByText(/Project Two/i)).not.toBeInTheDocument();
    });
    expect(screen.getByText(/Project One/i)).toBeInTheDocument();
  });
});
