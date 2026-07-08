import { appendJobLearningEvent, clearJobLearningEvents } from "./jobLearningStore";
import {
  buildJobLearningSnapshot,
  buildJobLearningSnapshotFromStore,
  summarizeJobLearningSnapshot,
} from "./jobLearningSnapshot";

describe("jobLearningSnapshot", () => {
  beforeEach(() => {
    localStorage.clear();
    jest.restoreAllMocks();
  });

  test("empty input returns safe snapshot", () => {
    const snapshot = buildJobLearningSnapshot([]);

    expect(typeof snapshot.generatedAt === "number" || snapshot.generatedAt === null).toBe(true);
    expect(snapshot.stats.totalEvents).toBe(0);
    expect(snapshot.workflowCandidates).toEqual([]);
    expect(snapshot.registry).toEqual([]);
    expect(snapshot.registryHealth.runtimeApprovedCount).toBe(0);
    expect(snapshot.registryHealth.reusableEnabledCount).toBe(0);
  });

  test("malformed events do not throw", () => {
    expect(() => buildJobLearningSnapshot([null, "bad", [], { timestamp: 1 }])).not.toThrow();
    const snapshot = buildJobLearningSnapshot([null, "bad", [], { timestamp: 1 }]);
    expect(snapshot.stats.totalEvents).toBe(0);
  });

  test("repeated workflow events produce registry candidates in snapshot", () => {
    const events = [
      { sectionKey: "scope", seam: "assist_request", timestamp: 1 },
      { sectionKey: "scope", seam: "assist_result", timestamp: 2 },
      { sectionKey: "scope", seam: "assist_accept", timestamp: 3 },
      { seam: "document_save", saveType: "estimate", docType: "estimate", timestamp: 4 },
      { sectionKey: "scope", seam: "assist_request", timestamp: 400000 },
      { sectionKey: "scope", seam: "assist_result", timestamp: 400001 },
      { sectionKey: "scope", seam: "assist_accept", timestamp: 400002 },
      { seam: "document_save", saveType: "estimate", docType: "estimate", timestamp: 400003 },
    ];

    const snapshot = buildJobLearningSnapshot(events);
    expect(snapshot.workflowCandidates.length).toBeGreaterThan(0);
    expect(snapshot.registry.length).toBeGreaterThan(0);
    expect(snapshot.registry[0].reusable).toBe(false);
    expect(snapshot.registry[0].approvedForRuntime).toBe(false);
  });

  test("summary returns compact counts", () => {
    const snapshot = buildJobLearningSnapshot([
      { sectionKey: "scope", seam: "assist_request", timestamp: 1 },
      { sectionKey: "scope", seam: "assist_result", timestamp: 2 },
      { sectionKey: "scope", seam: "assist_accept", timestamp: 3 },
      { seam: "document_save", saveType: "estimate", docType: "estimate", timestamp: 4 },
      { sectionKey: "scope", seam: "assist_request", timestamp: 400000 },
      { sectionKey: "scope", seam: "assist_result", timestamp: 400001 },
      { sectionKey: "scope", seam: "assist_accept", timestamp: 400002 },
      { seam: "document_save", saveType: "estimate", docType: "estimate", timestamp: 400003 },
    ]);

    const summary = summarizeJobLearningSnapshot(snapshot);
    expect(summary.totalEvents).toBe(snapshot.stats.totalEvents);
    expect(summary.runtimeApprovedCount).toBe(0);
    expect(summary.reusableEnabledCount).toBe(0);
    expect(summary.strongestWorkflowId).toBeTruthy();
  });

  test("buildJobLearningSnapshotFromStore reads from current store safely", () => {
    appendJobLearningEvent({ seam: "assist_request", sectionKey: "scope", timestamp: 1 });
    appendJobLearningEvent({ seam: "assist_result", sectionKey: "scope", timestamp: 2 });

    const snapshot = buildJobLearningSnapshotFromStore();
    expect(snapshot.stats.totalEvents).toBe(2);
  });

  test("no writes occur during snapshot build", () => {
    appendJobLearningEvent({ seam: "assist_request", sectionKey: "scope", timestamp: 1 });
    const setItemSpy = jest.spyOn(Storage.prototype, "setItem");

    buildJobLearningSnapshotFromStore();

    expect(setItemSpy).not.toHaveBeenCalled();
  });

  test("runtimeApprovedCount and reusableEnabledCount remain 0 with default registry entries", () => {
    const snapshot = buildJobLearningSnapshot([
      { sectionKey: "scope", seam: "assist_request", timestamp: 1 },
      { sectionKey: "scope", seam: "assist_result", timestamp: 2 },
      { sectionKey: "scope", seam: "assist_accept", timestamp: 3 },
      { seam: "document_save", saveType: "estimate", docType: "estimate", timestamp: 4 },
      { sectionKey: "scope", seam: "assist_request", timestamp: 400000 },
      { sectionKey: "scope", seam: "assist_result", timestamp: 400001 },
      { sectionKey: "scope", seam: "assist_accept", timestamp: 400002 },
      { seam: "document_save", saveType: "estimate", docType: "estimate", timestamp: 400003 },
    ]);

    expect(snapshot.registryHealth.runtimeApprovedCount).toBe(0);
    expect(snapshot.registryHealth.reusableEnabledCount).toBe(0);
  });

  afterEach(() => {
    clearJobLearningEvents();
  });
});
