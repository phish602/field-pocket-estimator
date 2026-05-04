import { render, screen, fireEvent } from "@testing-library/react";
import { STORAGE_KEYS } from "../constants/storageKeys";
import ProjectDetailScreen from "./ProjectDetailScreen";

const PROJECTS_KEY = STORAGE_KEYS.PROJECTS;
const PROJECT_DETAIL_TARGET_KEY = "estipaid-project-detail-target-v1";

function seedProject(project) {
  localStorage.setItem(PROJECTS_KEY, JSON.stringify([project]));
}

function seedProjectDetailTarget(projectId) {
  localStorage.setItem(PROJECT_DETAIL_TARGET_KEY, projectId);
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

describe("ProjectDetailScreen projects-changed dispatch", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  test("dispatches estipaid:projects-changed when project status is changed", () => {
    const project = createProject({ id: "proj_1", status: "active" });
    seedProject(project);
    seedProjectDetailTarget("proj_1");

    const dispatchSpy = jest.spyOn(window, "dispatchEvent");

    render(<ProjectDetailScreen onBack={() => {}} onOpenProjectDetail={() => {}} />);

    // Find and click a different status button
    const completedButton = screen.getByRole("button", { name: /completed/i });
    fireEvent.click(completedButton);

    // Verify estipaid:projects-changed was dispatched
    const projectsChangedEvents = dispatchSpy.mock.calls.filter(
      (call) => call[0]?.type === "estipaid:projects-changed"
    );
    expect(projectsChangedEvents.length).toBeGreaterThanOrEqual(1);

    // Verify the status was actually updated in storage
    const updatedProjects = JSON.parse(localStorage.getItem(PROJECTS_KEY));
    expect(updatedProjects[0].status).toBe("completed");

    dispatchSpy.mockRestore();
  });

  test("dispatches estipaid:projects-changed when changing between different statuses", () => {
    const project = createProject({ id: "proj_1", status: "draft" });
    seedProject(project);
    seedProjectDetailTarget("proj_1");

    const dispatchSpy = jest.spyOn(window, "dispatchEvent");

    render(<ProjectDetailScreen onBack={() => {}} onOpenProjectDetail={() => {}} />);

    // Change from draft to estimating
    const estimatingButton = screen.getByRole("button", { name: /estimating/i });
    fireEvent.click(estimatingButton);

    // Verify estipaid:projects-changed was dispatched
    const projectsChangedEvents = dispatchSpy.mock.calls.filter(
      (call) => call[0]?.type === "estipaid:projects-changed"
    );
    expect(projectsChangedEvents.length).toBeGreaterThanOrEqual(1);

    // Verify the status was updated
    const updatedProjects = JSON.parse(localStorage.getItem(PROJECTS_KEY));
    expect(updatedProjects[0].status).toBe("estimating");

    dispatchSpy.mockRestore();
  });

  test("dispatches estipaid:projects-changed even when clicking the same status", () => {
    const project = createProject({ id: "proj_1", status: "active" });
    seedProject(project);
    seedProjectDetailTarget("proj_1");

    const dispatchSpy = jest.spyOn(window, "dispatchEvent");

    render(<ProjectDetailScreen onBack={() => {}} onOpenProjectDetail={() => {}} />);

    // Click the same status (active)
    const activeButton = screen.getByRole("button", { name: /^active$/i });
    fireEvent.click(activeButton);

    // Verify estipaid:projects-changed was dispatched (updateProjectStoredStatus returns existing project)
    const projectsChangedEvents = dispatchSpy.mock.calls.filter(
      (call) => call[0]?.type === "estipaid:projects-changed"
    );
    expect(projectsChangedEvents.length).toBeGreaterThanOrEqual(1);

    dispatchSpy.mockRestore();
  });
});
