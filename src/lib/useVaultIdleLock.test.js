import React from "react";
import { act, render } from "@testing-library/react";
import useVaultIdleLock from "./useVaultIdleLock";

function Probe(props) {
  useVaultIdleLock(props);
  return null;
}

function advance(milliseconds) {
  act(() => { jest.advanceTimersByTime(milliseconds); });
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date("2026-07-31T12:00:00.000Z"));
  localStorage.clear();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test("disabled state attaches no listeners and schedules no timer", () => {
  const add = jest.spyOn(window, "addEventListener");
  const timer = jest.spyOn(global, "setTimeout");
  render(<Probe enabled={false} minutes={5} onLock={jest.fn()} />);
  expect(add.mock.calls.map(([name]) => name)).not.toEqual(expect.arrayContaining(["pointerdown", "keydown", "touchstart", "wheel", "focus"]));
  expect(timer).not.toHaveBeenCalled();
});

test("an invalid duration safely uses the 30 minute default", () => {
  const onLock = jest.fn();
  render(<Probe enabled minutes={0} onLock={onLock} />);
  advance((30 * 60 * 1000) - 1);
  expect(onLock).not.toHaveBeenCalled();
  advance(1);
  expect(onLock).toHaveBeenCalledTimes(1);
});

test.each([5, 15, 30, 60])("locks at exactly the selected %s minute duration and never early", (minutes) => {
  const onLock = jest.fn();
  render(<Probe enabled minutes={minutes} onLock={onLock} />);
  advance((minutes * 60 * 1000) - 1);
  expect(onLock).not.toHaveBeenCalled();
  advance(1);
  expect(onLock).toHaveBeenCalledTimes(1);
});

test.each(["pointerdown", "keydown", "touchstart", "wheel"])("%s resets the deadline", (eventName) => {
  const onLock = jest.fn();
  render(<Probe enabled minutes={5} onLock={onLock} />);
  advance(4 * 60 * 1000);
  act(() => { window.dispatchEvent(new Event(eventName)); });
  advance((4 * 60 * 1000) + 59 * 1000);
  expect(onLock).not.toHaveBeenCalled();
  advance(1000);
  expect(onLock).toHaveBeenCalledTimes(1);
});

test.each(["mousemove", "pointermove", "scroll"])("excluded %s activity cannot extend the session", (eventName) => {
  const onLock = jest.fn();
  render(<Probe enabled minutes={5} onLock={onLock} />);
  advance(4 * 60 * 1000);
  act(() => { window.dispatchEvent(new Event(eventName)); });
  advance(60 * 1000);
  expect(onLock).toHaveBeenCalledTimes(1);
});

test("repeated activity leaves one effective deadline and activity after expiry locks instead of extending", () => {
  const onLock = jest.fn();
  render(<Probe enabled minutes={5} onLock={onLock} />);
  advance(60 * 1000);
  act(() => { window.dispatchEvent(new Event("pointerdown")); window.dispatchEvent(new Event("keydown")); });
  advance(5 * 60 * 1000);
  expect(onLock).toHaveBeenCalledTimes(1);
  act(() => { window.dispatchEvent(new Event("wheel")); });
  expect(onLock).toHaveBeenCalledTimes(1);
});

test("visibility return before deadline preserves it instead of granting a new interval", () => {
  const onLock = jest.fn();
  render(<Probe enabled minutes={5} onLock={onLock} />);
  advance(4 * 60 * 1000);
  act(() => { document.dispatchEvent(new Event("visibilitychange")); });
  advance(60 * 1000);
  expect(onLock).toHaveBeenCalledTimes(1);
});

test("visibility return after a throttled deadline locks immediately", () => {
  const onLock = jest.fn();
  render(<Probe enabled minutes={5} onLock={onLock} />);
  // Move only the controlled clock: the scheduled callback remains throttled
  // until a visibility return evaluates the in-memory deadline.
  act(() => { jest.setSystemTime(new Date("2026-07-31T12:05:00.000Z")); });
  expect(onLock).not.toHaveBeenCalled();
  act(() => { document.dispatchEvent(new Event("visibilitychange")); });
  expect(onLock).toHaveBeenCalledTimes(1);
});

test("focus evaluates the existing deadline without extending it and catches expiry", () => {
  const onLock = jest.fn();
  render(<Probe enabled minutes={5} onLock={onLock} />);
  advance(4 * 60 * 1000);
  act(() => { window.dispatchEvent(new Event("focus")); });
  advance(60 * 1000);
  expect(onLock).toHaveBeenCalledTimes(1);
  act(() => { window.dispatchEvent(new Event("focus")); });
  expect(onLock).toHaveBeenCalledTimes(1);
});

test("duration change resets a fresh deadline and disable or unmount clears it", () => {
  const onLock = jest.fn();
  const view = render(<Probe enabled minutes={5} onLock={onLock} />);
  advance(4 * 60 * 1000);
  view.rerender(<Probe enabled minutes={15} onLock={onLock} />);
  advance((15 * 60 * 1000) - 1);
  expect(onLock).not.toHaveBeenCalled();
  view.rerender(<Probe enabled={false} minutes={15} onLock={onLock} />);
  advance(60 * 60 * 1000);
  expect(onLock).not.toHaveBeenCalled();
  view.unmount();
  expect(onLock).not.toHaveBeenCalled();
});

test("re-enabling creates a new independent session and never touches storage, messaging, network, migration, or transitions", () => {
  const onLock = jest.fn();
  const local = jest.spyOn(Storage.prototype, "getItem");
  const session = jest.spyOn(Storage.prototype, "setItem");
  const dispatch = jest.spyOn(window, "dispatchEvent");
  const fetch = jest.spyOn(global, "fetch");
  const view = render(<Probe enabled minutes={5} onLock={onLock} />);
  view.rerender(<Probe enabled={false} minutes={5} onLock={onLock} />);
  view.rerender(<Probe enabled minutes={5} onLock={onLock} />);
  advance(5 * 60 * 1000);
  expect(onLock).toHaveBeenCalledTimes(1);
  expect(local).not.toHaveBeenCalled();
  expect(session).not.toHaveBeenCalled();
  expect(dispatch).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});
