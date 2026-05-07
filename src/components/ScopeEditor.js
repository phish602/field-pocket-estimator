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

  // Flat list with divider sentinels between button groups.
  const toolbarActions = [
    // Line-level formatters
    {
      icon: "H1",
      label: en ? "Heading" : "Encabezado",
      title: en
        ? "Heading — inserts ## marker at line start (cleaned in PDF export)"
        : "Encabezado — inserta marcador ## al inicio de la línea (se elimina al exportar el PDF)",
      action: () => applyResult(insertLinePrefix(ref.current, "## ")),
    },
    {
      icon: "•",
      label: en ? "Bullet list" : "Lista con viñetas",
      title: en
        ? "Bullet list — inserts - marker at line start"
        : "Lista con viñetas — inserta marcador - al inicio de la línea",
      action: () => applyResult(insertLinePrefix(ref.current, "- ")),
    },
    {
      icon: "1.",
      label: en ? "Numbered list" : "Lista numerada",
      title: en
        ? "Numbered list — inserts 1. marker at line start"
        : "Lista numerada — inserta marcador 1. al inicio de la línea",
      action: () => applyResult(insertLinePrefix(ref.current, "1. ")),
    },
    { divider: true },
    // Inline formatters
    {
      icon: "B",
      label: en ? "Bold" : "Negrita",
      title: en
        ? "Bold — select text first, then click (** markers, cleaned in PDF export)"
        : "Negrita — selecciona el texto primero (marcadores **, se eliminan al exportar el PDF)",
      extraStyle: { fontWeight: 900 },
      action: () =>
        applyResult(
          wrapSelectionMarkers(ref.current, "**", "**", en ? "bold text" : "texto en negrita")
        ),
    },
    {
      icon: "I",
      label: en ? "Italic" : "Cursiva",
      title: en
        ? "Italic — select text first, then click (_ markers, cleaned in PDF export)"
        : "Cursiva — selecciona el texto primero (marcadores _, se eliminan al exportar el PDF)",
      extraStyle: { fontStyle: "italic" },
      action: () =>
        applyResult(
          wrapSelectionMarkers(ref.current, "_", "_", en ? "italic text" : "texto en cursiva")
        ),
    },
    { divider: true },
    // Utility
    {
      icon: "🔗",
      label: en ? "Insert link" : "Insertar enlace",
      title: en
        ? "Insert link — inserts a plain text URL reference"
        : "Insertar enlace — inserta una referencia de URL en texto plano",
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
        {toolbarActions.map((btn, i) =>
          btn.divider ? (
            <span
              key={`divider-${i}`}
              className="pe-scope-toolbar-divider"
              aria-hidden="true"
            />
          ) : (
            <button
              key={btn.label}
              type="button"
              className="pe-btn pe-scope-toolbar-btn"
              title={btn.title}
              aria-label={btn.label}
              onClick={btn.action}
              style={btn.extraStyle}
              tabIndex={-1}
            >
              {btn.icon}
            </button>
          )
        )}
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
      <p className="pe-scope-helper">
        {en
          ? "Formatting markers stay editable here and are cleaned in the PDF export."
          : "Los marcadores de formato se editan aquí y se limpian al exportar el PDF."}
      </p>
    </div>
  );
}
