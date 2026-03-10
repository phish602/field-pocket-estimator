// @ts-nocheck
/* eslint-disable */

import React, { useEffect, useRef, useState } from "react";

const INPUT_SWITCH_BUTTON_WIDTH = 28;
const BLUR_COMMIT_DELAY_MS = 160;

export default function InlineCustomNumberField(props) {
  const {
    value,
    options = [],
    customOptionValue = "__custom__",
    customOptionLabel = "Custom",
    deriveSelection,
    optionToValue,
    formatOptionLabel,
    normalizeDraft,
    normalizeFinal,
    onValueChange,
    onValueCommit,
    onModeChange,
    onEditingChange,
    onInputCommit,
    onInputFocus,
    onInputBlur,
    className = "pe-input",
    style,
    wrapperStyle,
    inputMode = "decimal",
    placeholder = "",
    disabled = false,
    selectTitle = "",
    inputTitle = "",
    suffix = "",
    suffixStyle,
    switchButtonTitle = "Choose preset",
    switchButtonLabel = "v",
    enterKeyHint = "done",
    requireExplicitCommit = false,
    commitButtonTitle = "Done",
    commitButtonLabel = "✓",
  } = props || {};

  const resolveSelection = (nextValue) => {
    if (typeof deriveSelection === "function") {
      return deriveSelection(nextValue);
    }
    const valueText = String(nextValue ?? "");
    if (options.some((option) => String(option) === valueText)) return valueText;
    return customOptionValue;
  };

  const selectionToValue = (selection) => {
    if (typeof optionToValue === "function") return optionToValue(selection);
    return String(selection ?? "");
  };

  const renderOptionLabel = (option) => {
    if (typeof formatOptionLabel === "function") return formatOptionLabel(option);
    return String(option ?? "");
  };

  const nextDraftValue = (nextValue) => {
    if (typeof normalizeDraft === "function") return normalizeDraft(nextValue);
    return nextValue;
  };

  const nextFinalValue = (nextValue) => {
    if (typeof normalizeFinal === "function") return normalizeFinal(nextValue);
    return nextValue;
  };

  const [selection, setSelection] = useState(() => resolveSelection(value));
  const [isInlineCustomMode, setIsInlineCustomMode] = useState(() => resolveSelection(value) === customOptionValue);
  const [isInlineEditing, setIsInlineEditing] = useState(false);
  const inputRef = useRef(null);
  const pendingFocusRef = useRef(false);
  const lastInternalValueRef = useRef(null);
  const blurCommitTimerRef = useRef(null);
  const isEditingRef = useRef(false);

  const clearBlurCommitTimer = () => {
    if (!blurCommitTimerRef.current) return;
    clearTimeout(blurCommitTimerRef.current);
    blurCommitTimerRef.current = null;
  };

  const setEditingState = (nextIsEditing, detail = null) => {
    if (isEditingRef.current === nextIsEditing) return;
    isEditingRef.current = nextIsEditing;
    setIsInlineEditing(nextIsEditing);
    onEditingChange?.(nextIsEditing, detail);
  };

  const finishCustomCommit = (rawValue, source) => {
    clearBlurCommitTimer();
    const draftValue = nextDraftValue(rawValue);
    const finalValue = nextFinalValue(rawValue);
    const commitDetail = {
      source,
      rawValue: String(rawValue ?? ""),
      draftValue,
      finalValue,
      isValid: draftValue !== "",
      isCommitted: true,
    };
    lastInternalValueRef.current = String(finalValue ?? "");
    if (typeof onValueCommit === "function") onValueCommit(finalValue, commitDetail);
    else onValueChange?.(finalValue);
    setEditingState(false, commitDetail);
    onInputBlur?.(finalValue, commitDetail);
    onInputCommit?.(finalValue, commitDetail);
    return finalValue;
  };

  useEffect(() => {
    const valueKey = String(value ?? "");
    if (lastInternalValueRef.current !== null && valueKey === lastInternalValueRef.current) {
      lastInternalValueRef.current = null;
      return;
    }
    const nextSelection = resolveSelection(value);
    setSelection(nextSelection);
    setIsInlineCustomMode(nextSelection === customOptionValue);
    if (nextSelection !== customOptionValue) {
      setEditingState(false, {
        source: "value-sync",
        selection: nextSelection,
      });
    }
  }, [value]);

  useEffect(() => {
    if (!pendingFocusRef.current || !isInlineCustomMode) return;
    pendingFocusRef.current = false;
    inputRef.current?.focus?.();
    inputRef.current?.select?.();
  }, [isInlineCustomMode]);

  useEffect(() => () => {
    clearBlurCommitTimer();
  }, []);

  const handleSelectChange = (event) => {
    const nextSelection = String(event?.target?.value ?? "");
    setSelection(nextSelection);

    if (nextSelection === customOptionValue) {
      const nextValue = nextFinalValue(value);
      setIsInlineCustomMode(true);
      pendingFocusRef.current = true;
      lastInternalValueRef.current = String(nextValue ?? "");
      onValueChange?.(nextValue);
      setEditingState(true, {
        source: "select-custom",
        selection: nextSelection,
      });
      onModeChange?.({
        selection: nextSelection,
        isCustomMode: true,
        source: "select-custom",
      });
      return;
    }

    const nextValue = selectionToValue(nextSelection);
    const commitDetail = {
      source: "select-preset",
      selection: nextSelection,
      rawValue: String(nextValue ?? ""),
      draftValue: nextValue,
      finalValue: nextValue,
      isValid: true,
      isCommitted: true,
    };
    clearBlurCommitTimer();
    setIsInlineCustomMode(false);
    lastInternalValueRef.current = String(nextValue ?? "");
    onValueChange?.(nextValue);
    onValueCommit?.(nextValue, commitDetail);
    setEditingState(false, commitDetail);
    onModeChange?.({
      selection: nextSelection,
      isCustomMode: false,
      source: "select-preset",
    });
  };

  const handleCustomChange = (event) => {
    const nextValue = nextDraftValue(event?.target?.value ?? "");
    lastInternalValueRef.current = String(nextValue ?? "");
    onValueChange?.(nextValue);
  };

  const handleCustomFocus = (event) => {
    clearBlurCommitTimer();
    setEditingState(true, {
      source: "focus",
      value: String(event?.target?.value ?? value ?? ""),
    });
    onInputFocus?.(event);
  };

  const handleCustomBlur = (event) => {
    if (!isEditingRef.current) return;
    const rawValue = String(event?.target?.value ?? value ?? "");
    clearBlurCommitTimer();
    blurCommitTimerRef.current = setTimeout(() => {
      if (typeof document !== "undefined" && inputRef.current === document.activeElement) return;
      if (requireExplicitCommit) {
        const draftValue = nextDraftValue(rawValue);
        const finalValue = nextFinalValue(rawValue);
        const blurDetail = {
          source: "blur",
          rawValue,
          draftValue,
          finalValue,
          isValid: draftValue !== "",
          isCommitted: false,
        };
        setEditingState(false, blurDetail);
        onInputBlur?.(String(value ?? ""), blurDetail);
        return;
      }
      finishCustomCommit(rawValue, "blur");
    }, BLUR_COMMIT_DELAY_MS);
  };

  const handleCustomKeyDown = (event) => {
    if (event?.key !== "Enter" && event?.key !== "NumpadEnter") return;
    event.preventDefault();
    const nextValue = finishCustomCommit(event?.currentTarget?.value ?? value ?? "", "enter");
    try {
      event?.currentTarget?.blur?.();
    } catch {}
    return nextValue;
  };

  const handleChoosePreset = () => {
    clearBlurCommitTimer();
    setSelection(resolveSelection(value));
    setIsInlineCustomMode(false);
    setEditingState(false, {
      source: "custom-to-select",
      selection,
    });
    onModeChange?.({
      selection,
      isCustomMode: false,
      source: "custom-to-select",
    });
  };

  const handleExplicitCommit = () => {
    if (!isInlineCustomMode) return;
    finishCustomCommit(String(inputRef.current?.value ?? value ?? ""), "explicit-button");
    try {
      inputRef.current?.blur?.();
    } catch {}
  };

  const effectiveInputPaddingRight = suffix
    ? (disabled ? 42 : 68)
    : (disabled ? 12 : 40);
  const trailingButtonLabel = requireExplicitCommit && isInlineEditing ? commitButtonLabel : switchButtonLabel;
  const trailingButtonTitle = requireExplicitCommit && isInlineEditing ? commitButtonTitle : switchButtonTitle;
  const handleTrailingButtonPointerDown = (event) => {
    event.preventDefault();
    if (requireExplicitCommit && isInlineEditing) {
      handleExplicitCommit();
      return;
    }
    handleChoosePreset();
  };

  return (
    <div style={{ position: "relative", width: "100%", ...wrapperStyle }}>
      {isInlineCustomMode ? (
        <>
          <input
            ref={inputRef}
            className={className}
            value={String(value ?? "")}
            onChange={handleCustomChange}
            onFocus={handleCustomFocus}
            onBlur={handleCustomBlur}
            onKeyDown={handleCustomKeyDown}
            inputMode={inputMode}
            placeholder={placeholder}
            disabled={disabled}
            title={inputTitle || selectTitle}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            enterKeyHint={enterKeyHint}
            style={{ width: "100%", paddingRight: effectiveInputPaddingRight, ...style }}
          />
          {suffix ? (
            <span
              style={{
                position: "absolute",
                right: disabled ? 12 : (INPUT_SWITCH_BUTTON_WIDTH + 14),
                top: "50%",
                transform: "translateY(-50%)",
                fontSize: 12,
                fontWeight: 900,
                color: "rgba(229,238,245,0.86)",
                lineHeight: 1,
                pointerEvents: "none",
                ...suffixStyle,
              }}
            >
              {suffix}
            </span>
          ) : null}
          {!disabled ? (
            <button
              type="button"
              className="pe-btn pe-btn-ghost"
              onPointerDown={handleTrailingButtonPointerDown}
              title={trailingButtonTitle}
              aria-label={trailingButtonTitle}
              style={{
                position: "absolute",
                top: 4,
                right: 4,
                width: INPUT_SWITCH_BUTTON_WIDTH,
                minWidth: INPUT_SWITCH_BUTTON_WIDTH,
                height: "calc(100% - 8px)",
                minHeight: 0,
                padding: 0,
                borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.08)",
                background: "rgba(255,255,255,0.05)",
                color: "rgba(229,238,245,0.88)",
                fontSize: 12,
                fontWeight: 900,
                lineHeight: 1,
              }}
            >
              {trailingButtonLabel}
            </button>
          ) : null}
        </>
      ) : (
        <select
          className={className}
          value={selection}
          onChange={handleSelectChange}
          disabled={disabled}
          title={selectTitle}
          style={{ width: "100%", ...style }}
        >
          <option value={customOptionValue}>{customOptionLabel}</option>
          {options.map((option) => (
            <option key={String(option)} value={String(option)}>
              {renderOptionLabel(option)}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
