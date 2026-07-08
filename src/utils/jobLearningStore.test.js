import { readJobLearningEvents, appendJobLearningEvent, clearJobLearningEvents } from "./jobLearningStore";
import { STORAGE_KEYS } from "./storageKeys";

describe("jobLearningStore", () => {
  const key = STORAGE_KEYS.JOB_LEARNING_EVENTS;

  beforeEach(() => {
    localStorage.clear();
  });

  test("malformed localStorage returns []", () => {
    localStorage.setItem(key, "{bad json");
    expect(readJobLearningEvents()).toEqual([]);
  });

  test("append ignores invalid and non-object events", () => {
    appendJobLearningEvent(null);
    appendJobLearningEvent("bad");
    appendJobLearningEvent(["bad"]);
    expect(readJobLearningEvents()).toEqual([]);
  });

  test("append caps stored records at 250 and keeps newest records", () => {
    for (let i = 0; i < 260; i += 1) {
      appendJobLearningEvent({ seam: "assist_request", timestamp: i, inputLength: i });
    }

    const events = readJobLearningEvents();
    expect(events).toHaveLength(250);
    expect(events[0].timestamp).toBe(10);
    expect(events[249].timestamp).toBe(259);
  });

  test("clearJobLearningEvents removes stored events", () => {
    appendJobLearningEvent({ seam: "assist_request", timestamp: 1 });
    expect(readJobLearningEvents()).toHaveLength(1);
    expect(clearJobLearningEvents()).toEqual([]);
    expect(readJobLearningEvents()).toEqual([]);
    expect(localStorage.getItem(key)).toBeNull();
  });

  test("helpers never throw", () => {
    expect(() => readJobLearningEvents()).not.toThrow();
    expect(() => appendJobLearningEvent({ seam: "assist_request", timestamp: 1 })).not.toThrow();
    expect(() => clearJobLearningEvents()).not.toThrow();
  });
});
