// @ts-nocheck
/* eslint-disable */
import React, { createRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import ScopeEditor from "./ScopeEditor";

function renderEditor(overrides = {}) {
  const onChange = jest.fn();
  const props = {
    value: "",
    onChange,
    placeholder: "Describe the work…",
    minHeight: 170,
    lang: "en",
    ...overrides,
    onChange: overrides.onChange || onChange,
  };
  const result = render(<ScopeEditor {...props} />);
  return { ...result, onChange: props.onChange };
}

function getTextarea(container) {
  return container.querySelector("textarea");
}

// ── Render ──────────────────────────────────────────────────────────────────

test("renders textarea and toolbar", () => {
  const { container } = renderEditor({ value: "Some scope text" });
  expect(getTextarea(container)).toBeInTheDocument();
  expect(screen.getByRole("toolbar")).toBeInTheDocument();
});

test("textarea value reflects value prop", () => {
  const { container } = renderEditor({ value: "Roof replacement scope" });
  expect(getTextarea(container).value).toBe("Roof replacement scope");
});

test("empty value renders empty textarea", () => {
  const { container } = renderEditor({ value: "" });
  expect(getTextarea(container).value).toBe("");
});

test("old plain scopeNotes hydrates into editor correctly", () => {
  const plain = "Tear off existing roof\n- Remove debris\n- Install underlayment";
  const { container } = renderEditor({ value: plain });
  expect(getTextarea(container).value).toBe(plain);
});

// ── Typing ───────────────────────────────────────────────────────────────────

test("typing in the textarea calls onChange with new value", () => {
  const onChange = jest.fn();
  const { container } = renderEditor({ value: "", onChange });
  const ta = getTextarea(container);
  fireEvent.change(ta, { target: { value: "New scope text" } });
  expect(onChange).toHaveBeenCalledWith("New scope text");
});

test("typing does not call onChange with old value", () => {
  const onChange = jest.fn();
  const { container } = renderEditor({ value: "existing", onChange });
  const ta = getTextarea(container);
  fireEvent.change(ta, { target: { value: "existing updated" } });
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange).toHaveBeenCalledWith("existing updated");
});

// ── Toolbar buttons present ───────────────────────────────────────────────

test("toolbar renders Heading button", () => {
  renderEditor();
  expect(screen.getByRole("button", { name: /heading/i })).toBeInTheDocument();
});

test("toolbar renders Bullet button", () => {
  renderEditor();
  expect(screen.getByRole("button", { name: /bullet/i })).toBeInTheDocument();
});

test("toolbar renders Numbered button", () => {
  renderEditor();
  expect(screen.getByRole("button", { name: /numbered/i })).toBeInTheDocument();
});

test("toolbar renders Bold button", () => {
  renderEditor();
  expect(screen.getByRole("button", { name: /bold/i })).toBeInTheDocument();
});

test("toolbar renders Italic button", () => {
  renderEditor();
  expect(screen.getByRole("button", { name: /italic/i })).toBeInTheDocument();
});

test("toolbar renders Insert link button", () => {
  renderEditor();
  expect(screen.getByRole("button", { name: /insert link/i })).toBeInTheDocument();
});

test("no AI Assist button is rendered inside the scope editor", () => {
  renderEditor({ value: "scope text" });
  // AI Assist lives in EstimateForm outside this component — must not appear here
  expect(screen.queryByText(/ai assist/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/✦/)).not.toBeInTheDocument();
});

// ── Spanish locale ─────────────────────────────────────────────────────────

test("toolbar renders Spanish labels when lang=es", () => {
  renderEditor({ lang: "es" });
  expect(screen.getByRole("button", { name: /encabezado/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /viñeta/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /numerada/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /negrita/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /cursiva/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /insertar enlace/i })).toBeInTheDocument();
});

// ── Ref forwarding ──────────────────────────────────────────────────────────

test("textareaRef is attached to the underlying textarea", () => {
  const ref = createRef();
  const { container } = renderEditor({ textareaRef: ref });
  expect(ref.current).toBe(getTextarea(container));
});

// ── onResize callback ───────────────────────────────────────────────────────

test("onResize is called with the textarea element on change", () => {
  const onResize = jest.fn();
  const { container } = renderEditor({ value: "", onResize });
  const ta = getTextarea(container);
  fireEvent.change(ta, { target: { value: "text" } });
  expect(onResize).toHaveBeenCalledWith(ta);
});

// ── Toolbar button click calls onChange with plain-text result ──────────────

test("Heading button inserts ## prefix into empty value", () => {
  const onChange = jest.fn();
  const { container } = renderEditor({ value: "", onChange });
  const ta = getTextarea(container);

  // Simulate cursor at position 0
  Object.defineProperty(ta, "selectionStart", { get: () => 0, configurable: true });
  Object.defineProperty(ta, "selectionEnd", { get: () => 0, configurable: true });
  ta.value = "";

  fireEvent.click(screen.getByRole("button", { name: /heading/i }));
  expect(onChange).toHaveBeenCalledWith("## ");
});

test("Bullet button inserts - prefix into empty value", () => {
  const onChange = jest.fn();
  const { container } = renderEditor({ value: "", onChange });
  const ta = getTextarea(container);

  Object.defineProperty(ta, "selectionStart", { get: () => 0, configurable: true });
  Object.defineProperty(ta, "selectionEnd", { get: () => 0, configurable: true });
  ta.value = "";

  fireEvent.click(screen.getByRole("button", { name: /bullet/i }));
  expect(onChange).toHaveBeenCalledWith("- ");
});

test("Numbered button inserts 1. prefix into empty value", () => {
  const onChange = jest.fn();
  const { container } = renderEditor({ value: "", onChange });
  const ta = getTextarea(container);

  Object.defineProperty(ta, "selectionStart", { get: () => 0, configurable: true });
  Object.defineProperty(ta, "selectionEnd", { get: () => 0, configurable: true });
  ta.value = "";

  fireEvent.click(screen.getByRole("button", { name: /numbered/i }));
  expect(onChange).toHaveBeenCalledWith("1. ");
});

test("Bold button wraps selection with ** markers", () => {
  const onChange = jest.fn();
  const { container } = renderEditor({ value: "hello world", onChange });
  const ta = getTextarea(container);

  // Simulate selecting "world" (positions 6–11)
  Object.defineProperty(ta, "selectionStart", { get: () => 6, configurable: true });
  Object.defineProperty(ta, "selectionEnd", { get: () => 11, configurable: true });
  ta.value = "hello world";

  fireEvent.click(screen.getByRole("button", { name: /bold/i }));
  expect(onChange).toHaveBeenCalledWith("hello **world**");
});

test("Italic button wraps selection with _ markers", () => {
  const onChange = jest.fn();
  const { container } = renderEditor({ value: "hello world", onChange });
  const ta = getTextarea(container);

  Object.defineProperty(ta, "selectionStart", { get: () => 6, configurable: true });
  Object.defineProperty(ta, "selectionEnd", { get: () => 11, configurable: true });
  ta.value = "hello world";

  fireEvent.click(screen.getByRole("button", { name: /italic/i }));
  expect(onChange).toHaveBeenCalledWith("hello _world_");
});

test("Heading button toggles off an existing ## prefix", () => {
  const onChange = jest.fn();
  const { container } = renderEditor({ value: "## My heading", onChange });
  const ta = getTextarea(container);

  Object.defineProperty(ta, "selectionStart", { get: () => 4, configurable: true });
  Object.defineProperty(ta, "selectionEnd", { get: () => 4, configurable: true });
  ta.value = "## My heading";

  fireEvent.click(screen.getByRole("button", { name: /heading/i }));
  expect(onChange).toHaveBeenCalledWith("My heading");
});

test("output from toolbar buttons is always plain text — no HTML tags", () => {
  const onChange = jest.fn();
  const { container } = renderEditor({ value: "scope text", onChange });
  const ta = getTextarea(container);

  Object.defineProperty(ta, "selectionStart", { get: () => 0, configurable: true });
  Object.defineProperty(ta, "selectionEnd", { get: () => 10, configurable: true });
  ta.value = "scope text";

  fireEvent.click(screen.getByRole("button", { name: /bold/i }));
  const called = onChange.mock.calls[0][0];
  expect(called).not.toMatch(/<[^>]+>/); // no HTML tags
});

// ── Helper text ───────────────────────────────────────────────────────────────

test("helper text is rendered", () => {
  const { container } = renderEditor();
  const helper = container.querySelector(".pe-scope-helper");
  expect(helper).toBeInTheDocument();
  expect(helper.textContent).toMatch(/formatting markers/i);
});

test("helper text renders in Spanish when lang=es", () => {
  const { container } = renderEditor({ lang: "es" });
  const helper = container.querySelector(".pe-scope-helper");
  expect(helper).toBeInTheDocument();
  expect(helper.textContent).toMatch(/marcadores de formato/i);
});

// ── Toolbar icon clarity ──────────────────────────────────────────────────────

test("Heading button icon is H1", () => {
  renderEditor();
  const headingBtn = screen.getByRole("button", { name: /heading/i });
  expect(headingBtn.textContent).toBe("H1");
});

// ── No image insert ───────────────────────────────────────────────────────────

test("no image insert button exists inside ScopeEditor", () => {
  renderEditor({ value: "scope text" });
  expect(
    screen.queryByRole("button", { name: /image|photo|upload|attach/i })
  ).not.toBeInTheDocument();
});

// ── No-selection bold/italic placeholders ─────────────────────────────────────

test("Bold button with no selection inserts bold text placeholder", () => {
  const onChange = jest.fn();
  const { container } = renderEditor({ value: "hello", onChange });
  const ta = getTextarea(container);

  Object.defineProperty(ta, "selectionStart", { get: () => 5, configurable: true });
  Object.defineProperty(ta, "selectionEnd", { get: () => 5, configurable: true });
  ta.value = "hello";

  fireEvent.click(screen.getByRole("button", { name: /bold/i }));
  expect(onChange).toHaveBeenCalledWith("hello**bold text**");
});

test("Italic button with no selection inserts italic text placeholder", () => {
  const onChange = jest.fn();
  const { container } = renderEditor({ value: "hello", onChange });
  const ta = getTextarea(container);

  Object.defineProperty(ta, "selectionStart", { get: () => 5, configurable: true });
  Object.defineProperty(ta, "selectionEnd", { get: () => 5, configurable: true });
  ta.value = "hello";

  fireEvent.click(screen.getByRole("button", { name: /italic/i }));
  expect(onChange).toHaveBeenCalledWith("hello_italic text_");
});
