import React from "react";

/**
 * Canonical Field System Contract (Estimator is the source of truth):
 * - Wrapper: `.pe-field` controls stack rhythm and spacing.
 * - Label: `.pe-field-label` controls typography (no inline font sizing).
 * - Control: `.pe-input.pe-field-control` controls shape, padding, and focus.
 * - Help/Error text: `.pe-field-helper` / `.pe-field-error` for consistent tone.
 */
export default function Field({
  as = "input",
  label,
  helperText,
  errorText,
  wrapperStyle,
  controlStyle,
  fieldClassName = "",
  labelClassName = "",
  controlClassName = "",
  className = "",
  children,
  ...controlProps
}) {
  const { style: controlInlineStyle, ...restControlProps } = controlProps;
  const Tag = as === "textarea" ? "textarea" : as === "select" ? "select" : "input";
  const wrapperClass = ["pe-field", fieldClassName, className].filter(Boolean).join(" ");
  const labelClasses = ["pe-field-label", labelClassName].filter(Boolean).join(" ");
  const inputClasses = ["pe-input", "pe-field-control", controlClassName].filter(Boolean).join(" ");

  return (
    <div className={wrapperClass} style={wrapperStyle}>
      {label ? <div className={labelClasses}>{label}</div> : null}
      <Tag className={inputClasses} style={{ ...(controlInlineStyle || {}), ...(controlStyle || {}) }} {...restControlProps}>
        {as === "select" ? children : null}
      </Tag>
      {helperText ? <div className="pe-field-helper">{helperText}</div> : null}
      {errorText ? <div className="pe-field-error">{errorText}</div> : null}
    </div>
  );
}
