"use client";

import { CircleHelp } from "lucide-react";
import { useState, type ReactNode } from "react";
import { METRIC_DOCS, type MetricId } from "@/core/analysis/metric-docs";

export function LabeledSelect<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-muted">
      {label}
      <select
        value={String(value)}
        onChange={(event) => {
          const picked = options.find((o) => String(o.value) === event.target.value);
          if (picked) onChange(picked.value);
        }}
        className="rounded border border-line bg-raised px-1.5 py-1 text-xs tabular-nums text-ink"
      >
        {options.map((option) => (
          <option key={String(option.value)} value={String(option.value)}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex rounded border border-line">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={`px-2 py-1 text-xs first:rounded-l last:rounded-r ${
            value === option.value ? "bg-raised text-ink" : "text-muted hover:text-ink"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function IconButton({
  label,
  onClick,
  active,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-md p-1.5 hover:bg-raised disabled:opacity-40 disabled:hover:bg-transparent ${
        active ? "text-accent" : "text-muted hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

/** An inline, expandable definition of a measurement. */
export function Explained({ metric, children }: { metric: MetricId; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const doc = METRIC_DOCS[metric];
  return (
    <div>
      <div className="flex items-center gap-1">
        {children}
        <button
          type="button"
          aria-expanded={open}
          aria-label={`Explain ${doc.title}`}
          onClick={() => setOpen(!open)}
          className={open ? "text-accent" : "text-faint hover:text-muted"}
        >
          <CircleHelp className="size-3.5" aria-hidden />
        </button>
      </div>
      {open && (
        <div className="mt-1.5 mb-2 space-y-1 rounded border border-line bg-deep p-2 text-xs leading-relaxed">
          <p className="text-ink">
            {doc.title} <span className="text-faint">· {doc.kind}</span>
          </p>
          {"formula" in doc && <p className="font-mono text-[11px] text-accent">{doc.formula}</p>}
          <p className="text-muted">{doc.meaning}</p>
        </div>
      )}
    </div>
  );
}
