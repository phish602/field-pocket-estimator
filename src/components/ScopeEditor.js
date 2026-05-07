// @ts-nocheck
/* eslint-disable */
import React, { useRef } from "react";

// Inserts or toggles a line-level prefix (e.g. "## ", "- ", "1. ") at the cursor line.
function insertLinePrefix(el, prefix) {
  if (!el) return null;
  const pos = el.selectionStart ?? 0;
  const text = el.value;
  const lineStart = text.lastIndexOf("\n", pos - 1) + 1;
  const afterStart = text.slice(lineStart);
  const lineEnd = afterStart.indexOf("\n");
  const lineText = lineEnd === -1 ? afterStart : afterStart.slice(0, lineEnd);

  if (lineText.startsWith(prefix)) {
    // Toggle off
    const newText =
      text.slice(0, lineStart) +
      lineText.slice(prefix.length) +
      text.slice(lineStart + lineText.length);
    return { newText, newCursor: Math.max(lineStart, pos - prefix.length) };
  }
  const newText = text.slice(0, lineStart) + prefix + text.slice(lineStart);
  return { newText, newCursor: pos + prefix.length };
}

// Wraps the current selection (or defaultText) with prefix/suffix markers.
function wrapSelectionMarkers(el, prefix, suffix, defaultText = "text") {
  if (!el) return null;
  const start = el.selectionStart ?? 0;
  const end = el.selectionEnd ?? 0;
  const text = el.value;
  const selected = text.slice(start, end) || defaultText;
  const newText = text.slice(0, start) + prefix + selected + suffix + text.slice(end);
  return { newText, newCursor: start + prefix.length + selected.length + suffix.length };
}

/**
 * ScopeEditor — rich composition shell for the Scope of Work section.
 *
 * Reads from and writes to plain-text `scopeNotes` — the toolbar inserts
 * markdown-style plain-text markers, not HTML or block JSON.
 *
 * Props:
 *   value        — current scopeNotes string
 *   onChange     — called with the updated string (maps to patch("scopeNotes", ...))
 *   textareaRef  — forwarded ref for the underlying textarea (for autoResize)
 *   onResize     — called with the textarea element after cursor changes
 *   placeholder  — textarea placeholder text
 *   minHeight    — minimum textarea height (px)
 *   lang         — "en" or "es"
 */
export default function ScopeEditor({
  value = "",
  onChange,
  textareaRef,
  onResize,
  placeholder = "",
  minHeight = 170,
  lang = "en",
}) {
  const localRef = useRef(null);
  const ref = textareaRef || localRef;

  function applyResult(result) {
    if (!result || !ref.current) return;
    const { newText, newCursor } = result;
    onChange(newText);
    requestAnimationFrame(() => {
      if (!ref.current) return;
      ref.current.focus();
      ref.current.setSelectionRange(newCursor, newCursor);
      if (onResize) onResize(ref.current);
    });
  }

  function handleInsertLink() {
    const url = window.prompt(
      lang === "es" ? "URL del enlace:" : "Link URL:",
      "https://"
    );
    if (!url || !url.trim()) return;
    const safeUrl = url.trim();
    if (!ref.current) return;
    const start = ref.current.selectionStart ?? 0;
    const end = ref.current.selectionEnd ?? 0;
    const text = ref.current.value;
    const selected = text.slice(start, end);
    const insertion = selected ? `${selected} (${safeUrl})` : safeUrl;
    applyResult({
      newText: text.slice(0, start) + insertion + text.slice(end),
      newCursor: start + insertion.length,
    });
  }

  const en = lang !== "es";
  const toolbarActions = [
    {
      icon: "H",
      label: en ? "Heading" : "Encabezado",
      action: () => applyResult(insertLinePrefix(ref.current, "## ")),
    },
    {
      icon: "•",
      label: en ? "Bullet" : "Viñeta",
      action: () => applyResult(insertLinePrefix(ref.current, "- ")),
    },
    {
      icon: "1.",
      label: en ? "Numbered" : "Numerado",
      action: () => applyResult(insertLinePrefix(ref.current, "1. ")),
    },
    {
      icon: "B",
      label: en ? "Bold" : "Negrita",
      extraStyle: { fontWeight: 900 },
      action: () =>
        applyResult(
          wrapSelectionMarkers(ref.current, "**", "**", en ? "text" : "texto")
        ),
    },
    {
      icon: "I",
      label: en ? "Italic" : "Cursiva",
      extraStyle: { fontStyle: "italic" },
      action: () =>
        applyResult(
          wrapSelectionMarkers(ref.current, "_", "_", en ? "text" : "texto")
        ),
    },
    {
      icon: "🔗",
      label: en ? "Insert link" : "Insertar enlace",
      action: handleInsertLink,
    },
  ];

  return (
    <div className="pe-scope-editor">
      <div
        className="pe-scope-toolbar"
        role="toolbar"
        aria-label={en ? "Scope formatting toolbar" : "Barra de herramientas de alcance"}
      >
        {toolbarActions.map((btn) => (
          <button
            key={btn.label}
            type="button"
            className="pe-btn pe-scope-toolbar-btn"
            title={btn.label}
            aria-label={btn.label}
            onClick={btn.action}
            style={btn.extraStyle}
            tabIndex={-1}
          >
            {btn.icon}
          </button>
        ))}
      </div>
      <textarea
        ref={ref}
        className="pe-input pe-textarea pe-scope-textarea"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          if (onResize) onResize(e.target);
        }}
        placeholder={placeholder}
        style={{ minHeight, resize: "none" }}
      />
    </div>
  );
}
