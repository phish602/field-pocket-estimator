import {
  CRASH_BOUNDARIES,
  CRASH_BOUNDARY_LABELS,
  HarnessInterrupt,
  crashBoundary,
  createCheckpointController,
  middleStep,
} from "./crashBoundaries";

test("the boundary table covers all twenty-five durable crash points exactly once", () => {
  expect(CRASH_BOUNDARIES).toHaveLength(25);
  expect(new Set(CRASH_BOUNDARY_LABELS).size).toBe(25);
  expect(CRASH_BOUNDARIES.map((boundary) => boundary.index)).toEqual(
    Array.from({ length: 25 }, (_, index) => index + 1),
  );
  CRASH_BOUNDARIES.forEach((boundary) => {
    expect(["suspend", "latch"]).toContain(boundary.mechanism);
    expect(Object.isFrozen(boundary)).toBe(true);
  });
});

test("boundary lookup is exact and rejects unknown labels", () => {
  expect(crashBoundary("after-manifest-commit").index).toBe(8);
  expect(crashBoundary("not-a-boundary")).toBeNull();
});

test("middleStep is never the first step of a multi-step loop and never overruns", () => {
  expect(middleStep(1)).toBe(1);
  expect(middleStep(2)).toBe(1);
  expect(middleStep(4)).toBe(2);
  expect(middleStep(32)).toBe(16);
  expect(middleStep(0)).toBe(1);
  expect(middleStep(-3)).toBe(1);
});

test("counters are scoped per hook and per stage", () => {
  const controller = createCheckpointController({});
  expect(controller.count("getItem")).toBe(1);
  expect(controller.count("getItem")).toBe(2);
  controller.setStage("verifying");
  expect(controller.count("getItem")).toBe(1);
  expect(controller.currentStage()).toBe("verifying");
});

test("an unarmed boundary never trips and an armed boundary trips exactly once", () => {
  const controller = createCheckpointController({ crashAt: "after-manifest-commit" });
  expect(controller.armed("before-manifest-commit")).toBe(false);
  expect(controller.armed("after-manifest-commit")).toBe(true);
  expect(() => controller.tripSync("after-manifest-commit")).toThrow(HarnessInterrupt);
  expect(controller.isLatched()).toBe(true);
  expect(controller.trippedAt()).toBe("after-manifest-commit");
  expect(controller.armed("after-manifest-commit")).toBe(false);
});

test("a synchronous trip records a sanitized marker carrying no value data", () => {
  const recorded = [];
  const controller = createCheckpointController({
    crashAt: "during-middle-plaintext-deletion",
    record: (marker) => recorded.push(marker),
  });
  controller.setStage("cleaning");
  expect(() => controller.tripSync("during-middle-plaintext-deletion")).toThrow(HarnessInterrupt);
  expect(recorded).toEqual([{ boundary: "during-middle-plaintext-deletion", stage: "cleaning", counters: 0 }]);
  expect(Object.keys(recorded[0]).sort()).toEqual(["boundary", "counters", "stage"]);
});

test("an asynchronous trip suspends forever instead of resolving", async () => {
  let suspended = false;
  const controller = createCheckpointController({
    crashAt: "after-prepared-created",
    suspend: () => { suspended = true; return new Promise(() => {}); },
  });
  const pending = controller.tripAsync("after-prepared-created");
  expect(suspended).toBe(true);
  const race = await Promise.race([pending, Promise.resolve("still-pending")]);
  expect(race).toBe("still-pending");
});
