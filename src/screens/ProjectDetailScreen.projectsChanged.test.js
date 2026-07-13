import { act, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { STORAGE_KEYS } from "../constants/storageKeys";

var mockActualUpdateProjectStoredStatus;

jest.mock("../lib/BusinessMutationGuardContext", () => ({
  useBusinessMutationGuard: jest.fn(),
}));

jest.mock("../utils/projects", () => {
  const actual = jest.requireActual("../utils/projects");
  mockActualUpdateProjectStoredStatus = actual.updateProjectStoredStatus;
  return {
    ...actual,
    updateProjectStoredStatus: jest.fn(actual.updateProjectStoredStatus),
  };
});

import ProjectDetailScreen from "./ProjectDetailScreen";

const { useBusinessMutationGuard } = require("../lib/BusinessMutationGuardContext");
const { updateProjectStoredStatus } = require("../utils/projects");

const PROJECTS_KEY = STORAGE_KEYS.PROJECTS;
const PROJECT_DETAIL_TARGET_KEY = "estipaid-project-detail-target-v1";

function seedProjects(projects) {
  localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
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
    createdAt: 100,
    updatedAt: 200,
    ...overrides,
  };
}

function readProjects() {
  return JSON.parse(localStorage.getItem(PROJECTS_KEY));
}

function collectProjectChangeEvents() {
  const snapshots = [];
  const listener = () => snapshots.push(readProjects());
  window.addEventListener("estipaid:projects-changed", listener);
  return {
    snapshots,
    dispose: () => window.removeEventListener("estipaid:projects-changed", listener),
  };
}

async function changeStatus(name) {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name }));
  });
}

describe("ProjectDetailScreen projects-changed dispatch", () => {
  beforeEach(() => {
    localStorage.clear();
    updateProjectStoredStatus.mockImplementation(mockActualUpdateProjectStoredStatus);
    useBusinessMutationGuard.mockReturnValue({
      ensureCanMutateBusinessData: jest.fn().mockResolvedValue({ ok: true }),
    });
  });

  afterEach(() => {
    localStorage.clear();
    jest.restoreAllMocks();
  });

  test("persists a status change before emitting exactly one project-change event and survives remount", async () => {
    const changed = createProject({ id: "proj_1", status: "active" });
    const unrelated = createProject({ id: "proj_2", projectName: "Unrelated", status: "draft" });
    seedProjects([changed, unrelated]);
    seedProjectDetailTarget(changed.id);
    const events = collectProjectChangeEvents();

    const view = render(<ProjectDetailScreen onBack={() => {}} onOpenProjectDetail={() => {}} />);
    await changeStatus(/completed/i);

    expect(events.snapshots).toHaveLength(1);
    expect(events.snapshots[0]).toEqual([
      expect.objectContaining({ id: "proj_1", status: "completed" }),
      expect.objectContaining({ id: "proj_2", projectName: "Unrelated", status: "draft" }),
    ]);
    expect(readProjects()).toEqual(events.snapshots[0]);

    view.unmount();
    render(<ProjectDetailScreen onBack={() => {}} onOpenProjectDetail={() => {}} />);
    expect(screen.getByRole("button", { name: /^completed$/i })).toHaveStyle({
      background: "rgba(99, 179, 237, 0.1)",
    });
    events.dispose();
  });

  test("emits one event for each distinct successful project mutation", async () => {
    const project = createProject({ id: "proj_1", status: "draft" });
    seedProjects([project]);
    seedProjectDetailTarget(project.id);
    const events = collectProjectChangeEvents();

    render(<ProjectDetailScreen onBack={() => {}} onOpenProjectDetail={() => {}} />);
    await changeStatus(/estimating/i);
    await changeStatus(/active/i);

    expect(events.snapshots).toEqual([
      [expect.objectContaining({ id: "proj_1", status: "estimating" })],
      [expect.objectContaining({ id: "proj_1", status: "active" })],
    ]);
    events.dispose();
  });

  test("preserves the established one-event contract for a same-status action", async () => {
    const project = createProject({ id: "proj_1", status: "active" });
    seedProjects([project]);
    seedProjectDetailTarget(project.id);
    const events = collectProjectChangeEvents();

    render(<ProjectDetailScreen onBack={() => {}} onOpenProjectDetail={() => {}} />);
    await changeStatus(/^active$/i);

    expect(events.snapshots).toEqual([
      [expect.objectContaining({ id: "proj_1", status: "active" })],
    ]);
    events.dispose();
  });

  test("a cancelled or guard-rejected project mutation emits no event", async () => {
    const project = createProject({ id: "proj_1", status: "active" });
    seedProjects([project]);
    seedProjectDetailTarget(project.id);
    useBusinessMutationGuard.mockReturnValue({
      ensureCanMutateBusinessData: jest.fn().mockResolvedValue({ ok: false, userMessage: "Blocked" }),
    });
    const alertSpy = jest.spyOn(window, "alert").mockImplementation(() => {});
    const events = collectProjectChangeEvents();

    render(<ProjectDetailScreen onBack={() => {}} onOpenProjectDetail={() => {}} />);
    await changeStatus(/completed/i);

    expect(events.snapshots).toEqual([]);
    expect(readProjects()).toEqual([project]);
    expect(alertSpy).toHaveBeenCalledWith("Blocked");
    events.dispose();
  });

  test("a failed project persistence emits no event", async () => {
    const project = createProject({ id: "proj_1", status: "active" });
    seedProjects([project]);
    seedProjectDetailTarget(project.id);
    updateProjectStoredStatus.mockReturnValueOnce(null);
    const events = collectProjectChangeEvents();

    render(<ProjectDetailScreen onBack={() => {}} onOpenProjectDetail={() => {}} />);
    await changeStatus(/completed/i);

    expect(events.snapshots).toEqual([]);
    expect(readProjects()).toEqual([project]);
    events.dispose();
  });

  test("StrictMode does not duplicate the project-change event for one user action", async () => {
    const project = createProject({ id: "proj_1", status: "active" });
    seedProjects([project]);
    seedProjectDetailTarget(project.id);
    const events = collectProjectChangeEvents();

    render(
      <StrictMode>
        <ProjectDetailScreen onBack={() => {}} onOpenProjectDetail={() => {}} />
      </StrictMode>
    );
    await changeStatus(/completed/i);

    expect(events.snapshots).toEqual([
      [expect.objectContaining({ id: "proj_1", status: "completed" })],
    ]);
    events.dispose();
  });
});
