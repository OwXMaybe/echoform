"use client";

import { AlertTriangle, Plus, Power, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import { Explained, IconButton, LabeledSelect, Segmented } from "@/components/shared/controls";
import {
  FILTER_ORDERS,
  FILTER_TYPES,
  maxDesignFrequency,
  usesGain,
  usesOrder,
  usesQ,
  type FilterConfiguration,
  type FilterOrder,
  type FilterType,
} from "@/core/dsp/filters";
import { audioStore } from "@/stores/audio-store";
import { useStore } from "@/stores/create-store";
import {
  addFilter,
  chainKey,
  changeFilterType,
  filterStore,
  MAX_FILTERS,
  removeFilter,
  resetFilters,
  setMonitor,
  updateFilter,
  type Monitor,
} from "@/stores/filter-store";
import { formatCount, formatDb, formatHz } from "@/utils/formatting";

const TYPE_LABELS: Record<FilterType, string> = {
  lowpass: "Low-pass",
  highpass: "High-pass",
  bandpass: "Band-pass",
  notch: "Notch",
  peaking: "Peaking EQ",
  lowshelf: "Low shelf",
  highshelf: "High shelf",
};
const TYPE_OPTIONS = FILTER_TYPES.map((value) => ({ value, label: TYPE_LABELS[value] }));
const ORDER_OPTIONS = FILTER_ORDERS.map((value) => ({
  value,
  label: `${value} (${value * 6} dB/oct)`,
}));
const MONITOR_OPTIONS: ReadonlyArray<{ value: Monitor; label: string }> = [
  { value: "original", label: "Original" },
  { value: "processed", label: "Processed" },
];

const FREQUENCY_LABEL: Record<FilterType, string> = {
  lowpass: "Cutoff",
  highpass: "Cutoff",
  bandpass: "Centre",
  notch: "Centre",
  peaking: "Centre",
  lowshelf: "Midpoint",
  highshelf: "Midpoint",
};

const MIN_HZ = 20;
const MIN_Q = 0.1;
const MAX_Q = 30;
const SLIDER_STEPS = 1000;

/** A log-scaled slider with an exact numeric field beside it. */
function LogControl({
  label,
  value,
  min,
  max,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
}) {
  const position = (Math.log(value / min) / Math.log(max / min)) * SLIDER_STEPS;
  return (
    <label className="flex items-center gap-1.5 text-xs text-muted">
      {label}
      <input
        type="range"
        min={0}
        max={SLIDER_STEPS}
        value={position}
        aria-valuetext={format(value)}
        onChange={(event) => {
          const fraction = Number(event.target.value) / SLIDER_STEPS;
          onChange(min * Math.pow(max / min, fraction));
        }}
        className="w-24"
      />
      <input
        type="number"
        min={min}
        max={max}
        step="any"
        aria-label={`${label} value`}
        value={Number(value.toPrecision(5))}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next) && next >= min && next <= max) onChange(next);
        }}
        className="w-20 rounded border border-line bg-raised px-1.5 py-1 text-xs tabular-nums text-ink"
      />
    </label>
  );
}

function FilterRow({ filter, sampleRate }: { filter: FilterConfiguration; sampleRate: number }) {
  const { id, filterType, frequency, q, gainDb, order, enabled } = filter;
  const set = (patch: Partial<FilterConfiguration>) => updateFilter(id, patch);
  return (
    <li
      className={`flex flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-line px-3 py-2 ${
        enabled ? "" : "opacity-60"
      }`}
      data-testid="filter-row"
    >
      <IconButton
        label={enabled ? `Disable ${TYPE_LABELS[filterType]}` : `Enable ${TYPE_LABELS[filterType]}`}
        active={enabled}
        onClick={() => set({ enabled: !enabled })}
      >
        <Power className="size-4" aria-hidden />
      </IconButton>
      <LabeledSelect
        label="Type"
        value={filterType}
        options={TYPE_OPTIONS}
        onChange={(value) => changeFilterType(id, value)}
      />
      <LogControl
        label={FREQUENCY_LABEL[filterType]}
        value={frequency}
        min={MIN_HZ}
        max={maxDesignFrequency(sampleRate)}
        format={formatHz}
        onChange={(value) => set({ frequency: value })}
      />
      {usesOrder(filterType) && (
        <LabeledSelect<FilterOrder>
          label="Order"
          value={order}
          options={ORDER_OPTIONS}
          onChange={(value) => set({ order: value })}
        />
      )}
      {usesQ(filter) ? (
        <LogControl
          label="Q"
          value={q}
          min={MIN_Q}
          max={MAX_Q}
          format={(value) => value.toFixed(2)}
          onChange={(value) => set({ q: value })}
        />
      ) : (
        <span className="text-xs text-faint">Q set by the Butterworth design</span>
      )}
      {usesGain(filterType) && (
        <label className="flex items-center gap-1.5 text-xs text-muted">
          Gain
          <input
            type="range"
            min={-24}
            max={24}
            step={0.5}
            value={gainDb}
            onChange={(event) => set({ gainDb: Number(event.target.value) })}
            className="w-24"
          />
          <span className="w-14 tabular-nums text-ink">{formatDb(gainDb, "dB")}</span>
        </label>
      )}
      <div className="ml-auto">
        <IconButton label={`Remove ${TYPE_LABELS[filterType]}`} onClick={() => removeFilter(id)}>
          <Trash2 className="size-4" aria-hidden />
        </IconButton>
      </div>
    </li>
  );
}

function AddFilter() {
  const [type, setType] = useState<FilterType>("lowpass");
  const count = useStore(filterStore, (s) => s.filters.length);
  return (
    <div className="flex items-center gap-2">
      <LabeledSelect label="Add" value={type} options={TYPE_OPTIONS} onChange={setType} />
      <button
        type="button"
        disabled={count >= MAX_FILTERS}
        title={count >= MAX_FILTERS ? `A chain holds up to ${MAX_FILTERS} filters` : undefined}
        onClick={() => addFilter(type)}
        className="flex items-center gap-1 rounded-md border border-line px-2 py-1 text-xs hover:bg-raised disabled:opacity-40 disabled:hover:bg-transparent"
      >
        <Plus className="size-3.5" aria-hidden />
        Add filter
      </button>
    </div>
  );
}

/** Says exactly what is playing and whether the rendered audio matches the settings. */
function RenderStatus() {
  const filters = useStore(filterStore, (s) => s.filters);
  const rendered = useStore(filterStore, (s) => s.rendered);
  const monitor = useStore(filterStore, (s) => s.monitor);
  const status = useStore(audioStore, (s) => s.status.filter);
  const progress = useStore(audioStore, (s) => s.progress.filter);
  const anyEnabled = filters.some((f) => f.enabled);
  const current = rendered !== null && rendered.key === chainKey(filters);

  let text: string;
  if (!anyEnabled) {
    text = "No filter is enabled, so there is no processed signal.";
  } else if (status === "error") {
    text = "Rendering failed. The original recording is unaffected.";
  } else if (current) {
    text = "Rendered into a separate buffer. The original recording is unchanged.";
  } else {
    text = `Rendering ${Math.round(progress * 100)}%…`;
  }

  return (
    <div className="space-y-1 border-b border-line px-3 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="flex items-center gap-2 text-muted">
          Listen to
          <Segmented
            label="Listen to"
            value={monitor}
            options={MONITOR_OPTIONS.filter((o) => o.value === "original" || rendered)}
            onChange={setMonitor}
          />
        </span>
        <span className="text-muted" role="status" data-testid="render-status">
          {text}
        </span>
        {rendered && monitor === "processed" && !current && (
          <span className="text-faint">Still playing the previous render.</span>
        )}
      </div>
      {rendered && (
        <p className="tabular-nums text-faint" data-testid="render-levels">
          Processed peak {formatDb(rendered.peakDb)} · RMS {formatDb(rendered.rmsDb)}
        </p>
      )}
      {rendered && rendered.overRangeSamples > 0 && (
        <p className="flex items-center gap-1.5 text-amber" data-testid="render-overrange">
          <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
          {formatCount(rendered.overRangeSamples)} processed samples exceed full scale and will
          clip on playback. Lower a gain to avoid it; the stored values are not clipped.
        </p>
      )}
    </div>
  );
}

export function FilterChain() {
  const filters = useStore(filterStore, (s) => s.filters);
  const sampleRate = useStore(audioStore, (s) => s.recording?.decoded.sampleRate ?? 48000);
  return (
    <section>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line px-3 py-2">
        <AddFilter />
        <button
          type="button"
          disabled={filters.length === 0}
          onClick={resetFilters}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted hover:bg-raised hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <RotateCcw className="size-3.5" aria-hidden />
          Reset
        </button>
        <div className="ml-auto">
          <Explained metric="filterResponse">
            <span className="text-xs text-muted">About</span>
          </Explained>
        </div>
      </div>
      {filters.length === 0 ? (
        <p className="border-b border-line px-3 py-3 text-sm text-muted">
          No filters yet. Add one to shape a separate copy of the audio.
        </p>
      ) : (
        <ul>
          {filters.map((filter) => (
            <FilterRow key={filter.id} filter={filter} sampleRate={sampleRate} />
          ))}
        </ul>
      )}
      <RenderStatus />
    </section>
  );
}
