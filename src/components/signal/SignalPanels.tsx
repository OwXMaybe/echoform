"use client";

import { CircleCheck, TriangleAlert } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Explained, LabeledSelect } from "@/components/shared/controls";
import { CHART } from "@/core/visualization/plot";
import type { MetricId } from "@/core/analysis/metric-docs";
import { audioStore } from "@/stores/audio-store";
import { useStore } from "@/stores/create-store";
import { seekTo } from "@/stores/playback-store";
import { selectionStore, setTimeSelection } from "@/stores/selection-store";
import { settingsStore } from "@/stores/settings-store";
import { formatCount, formatDb, formatTimePrecise } from "@/utils/formatting";
import { HistogramChart } from "./HistogramChart";

const THRESHOLDS = [-90, -80, -70, -60, -50, -40, -30].map((value) => ({
  value,
  label: `${value} dBFS`.replace("-", "−"),
}));
const DURATIONS = [0.05, 0.1, 0.25, 0.5, 1, 2, 5].map((value) => ({
  value,
  label: `${value} s`,
}));
const PADDINGS = [0, 0.01, 0.05, 0.1, 0.25].map((value) => ({ value, label: `${value} s` }));
const DC_LIMITS = [0.001, 0.005, 0.01, 0.05].map((value) => ({ value, label: String(value) }));

const SAMPLE_TICKS = [
  [0, "−1"],
  [0.25, "−0.5"],
  [0.5, "0"],
  [0.75, "+0.5"],
  [1, "+1"],
] as const;
const LEVEL_TICKS = [
  [0, "−96"],
  [0.25, "−72"],
  [0.5, "−48"],
  [0.75, "−24"],
  [1, "0"],
] as const;

function Panel({
  title,
  metric,
  actions,
  children,
}: {
  title: string;
  metric: MetricId;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="border-b border-line p-3">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-x-4 gap-y-1.5">
        <Explained metric={metric}>
          <h2 className="text-sm font-medium">{title}</h2>
        </Explained>
        {actions}
      </div>
      {children}
    </section>
  );
}

function selectRange(start: number, end: number): void {
  setTimeSelection(start, end);
  seekTo(start);
}

function scopeLabel(time: unknown): string {
  return time ? "selection" : "whole recording";
}

export function DistributionPanel() {
  const signal = useStore(audioStore, (s) => s.signal);
  const time = useStore(selectionStore, (s) => s.time);
  const [picked, setPicked] = useState(0);
  if (!signal) return <p className="p-3 text-sm text-muted">Measuring…</p>;
  const index = Math.min(picked, signal.length - 1);
  const { histogram, dynamics } = signal[index];
  const color = CHART.channels[index % CHART.channels.length];
  const { minDb, binDb } = dynamics.histogram;

  return (
    <>
      <Panel
        title="Amplitude and level distribution"
        metric="sampleHistogram"
        actions={
          signal.length > 1 && (
            <LabeledSelect
              label="Channel"
              value={index}
              options={signal.map(({ label }, value) => ({ value, label }))}
              onChange={setPicked}
            />
          )
        }
      >
        <p className="text-xs text-muted">
          {signal[index].label}, {scopeLabel(time)}. Count axes are logarithmic.
        </p>
        <div className="mt-1 grid gap-px bg-line lg:grid-cols-2">
          <div className="bg-surface">
            <HistogramChart
              counts={histogram.counts}
              color={color}
              xTicks={SAMPLE_TICKS}
              xLabel="Sample value"
              label={`Histogram of sample values for ${signal[index].label}`}
              describeBin={(bin, count) => {
                const width = 2 / histogram.counts.length;
                const low = -1 + bin * width;
                return `${low.toFixed(2)} to ${(low + width).toFixed(2)}  ·  ${formatCount(count)} samples`;
              }}
            />
          </div>
          <div className="bg-surface">
            <HistogramChart
              counts={dynamics.histogram.counts}
              color={color}
              xTicks={LEVEL_TICKS}
              xLabel="Short-term RMS level (dBFS)"
              label={`Histogram of short-term levels for ${signal[index].label}`}
              describeBin={(bin, count) => {
                const low = minDb + bin * binDb;
                return `${low} to ${low + binDb} dBFS  ·  ${formatCount(count)} blocks`;
              }}
            />
          </div>
        </div>
        {histogram.overRange > 0 && (
          <p className="mt-2 flex gap-1.5 text-xs">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-amber" aria-hidden />
            {formatCount(histogram.overRange)} samples exceed ±1. They are counted in the outer bins.
          </p>
        )}
      </Panel>
      <Panel title="Short-term level range" metric="dynamics">
        {dynamics.rangeDb === null ? (
          <p className="text-sm text-muted">
            {dynamics.blocks === 0
              ? "The scope is shorter than one 100 ms block."
              : "Nothing in the scope is above the −70 dBFS gate."}
          </p>
        ) : (
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="dynamics">
            {(
              [
                ["Range (P95 − P10)", formatDb(dynamics.rangeDb, "dB")],
                ["P95 level", formatDb(dynamics.p95Db)],
                ["Median level", formatDb(dynamics.p50Db)],
                ["P10 level", formatDb(dynamics.p10Db)],
              ] as const
            ).map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs text-muted">{label}</dt>
                <dd className="text-sm tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
        )}
        <p className="mt-2 text-[11px] text-faint">
          {signal[index].label}, {scopeLabel(time)}: {formatCount(dynamics.gatedBlocks)} of{" "}
          {formatCount(dynamics.blocks)} blocks above the gate. Not EBU LRA.
        </p>
      </Panel>
    </>
  );
}

export function SilencePanel() {
  const result = useStore(audioStore, (s) => s.silence);
  const threshold = useStore(settingsStore, (s) => s.silenceThresholdDb);
  const minimum = useStore(settingsStore, (s) => s.silenceMinSeconds);
  const padding = useStore(settingsStore, (s) => s.silencePaddingSeconds);

  return (
    <Panel
      title="Silence and low-level regions"
      metric="silence"
      actions={
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          <LabeledSelect
            label="Threshold"
            value={threshold}
            options={THRESHOLDS}
            onChange={(value) => settingsStore.set({ silenceThresholdDb: value })}
          />
          <LabeledSelect
            label="Min. duration"
            value={minimum}
            options={DURATIONS}
            onChange={(value) => settingsStore.set({ silenceMinSeconds: value })}
          />
          <LabeledSelect
            label="Padding"
            value={padding}
            options={PADDINGS}
            onChange={(value) => settingsStore.set({ silencePaddingSeconds: value })}
          />
        </div>
      }
    >
      {!result ? (
        <p className="text-sm text-muted">Scanning…</p>
      ) : result.regions.length === 0 ? (
        <p className="text-sm text-muted">No regions match these settings.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-xs tabular-nums" data-testid="silence">
              <thead>
                <tr className="text-left text-[11px] text-faint">
                  <th className="py-1 font-normal">Start</th>
                  <th className="font-normal">End</th>
                  <th className="font-normal">Duration</th>
                  <th className="font-normal">Peak</th>
                  <th className="font-normal">Type</th>
                </tr>
              </thead>
              <tbody>
                {result.regions.map((region) => (
                  <tr key={region.start} className="border-t border-line">
                    <td className="py-1">
                      <button
                        type="button"
                        className="text-accent hover:underline"
                        title="Select this region"
                        onClick={() => selectRange(region.start, region.end)}
                      >
                        {formatTimePrecise(region.start)}
                      </button>
                    </td>
                    <td>{formatTimePrecise(region.end)}</td>
                    <td>{region.duration.toFixed(3)} s</td>
                    <td>{formatDb(region.peakDb)}</td>
                    <td>{region.kind === "digital-silence" ? "Digital silence" : "Low-level audio"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-faint">
            {result.silentSeconds.toFixed(2)} s, {(result.ratio * 100).toFixed(1)}% of the whole
            recording. Threshold {String(result.options.thresholdDb).replace("-", "−")} dBFS.
            Shown in grey under the waveform.
          </p>
        </>
      )}
    </Panel>
  );
}

export function ClippingPanel() {
  const clipping = useStore(audioStore, (s) => s.scan?.clipping ?? null);
  return (
    <Panel title="Clipping intervals" metric="clipIntervals">
      {!clipping ? (
        <p className="text-sm text-muted">Scanning…</p>
      ) : clipping.totalIntervals === 0 ? (
        <p className="flex items-center gap-1.5 text-sm text-muted">
          <CircleCheck className="size-4" aria-hidden />
          No runs at digital full scale in the whole recording.
        </p>
      ) : (
        <>
          <p className="mb-1.5 flex items-center gap-1.5 text-sm">
            <TriangleAlert className="size-4 shrink-0 text-amber" aria-hidden />
            Possible digital clipping: {formatCount(clipping.totalIntervals)} interval
            {clipping.totalIntervals === 1 ? "" : "s"}, {formatCount(clipping.clippedSamples)}{" "}
            samples.
          </p>
          <div className="max-h-48 overflow-auto">
            <table className="w-full text-xs tabular-nums" data-testid="clipping">
              <thead>
                <tr className="text-left text-[11px] text-faint">
                  <th className="py-1 font-normal">Start</th>
                  <th className="font-normal">End</th>
                  <th className="font-normal">Samples</th>
                  <th className="font-normal">Channels</th>
                </tr>
              </thead>
              <tbody>
                {clipping.intervals.map((interval) => (
                  <tr key={interval.start} className="border-t border-line">
                    <td className="py-1">
                      <button
                        type="button"
                        className="text-accent hover:underline"
                        title="Select this interval"
                        onClick={() => selectRange(interval.start, interval.end)}
                      >
                        {formatTimePrecise(interval.start)}
                      </button>
                    </td>
                    <td>{formatTimePrecise(interval.end)}</td>
                    <td>{formatCount(interval.clippedSamples)}</td>
                    <td>{interval.channels.join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-faint">
            {clipping.totalIntervals > clipping.intervals.length &&
              `First ${clipping.intervals.length} shown. `}
            Shown in amber at the top of the waveform.
          </p>
        </>
      )}
    </Panel>
  );
}

export function DcOffsetPanel() {
  const amplitude = useStore(audioStore, (s) => s.amplitude);
  const limit = useStore(settingsStore, (s) => s.dcWarningThreshold);
  const time = useStore(selectionStore, (s) => s.time);
  return (
    <Panel
      title="DC offset"
      metric="dcOffset"
      actions={
        <LabeledSelect
          label="Warn above"
          value={limit}
          options={DC_LIMITS}
          onChange={(value) => settingsStore.set({ dcWarningThreshold: value })}
        />
      }
    >
      {!amplitude ? (
        <p className="text-sm text-muted">Measuring…</p>
      ) : (
        <ul className="space-y-1 text-sm" data-testid="dc-offset">
          {amplitude.map(({ label, measurement }) => {
            const over = Math.abs(measurement.mean) > limit;
            return (
              <li key={label} className="flex items-center gap-1.5 tabular-nums">
                {over ? (
                  <TriangleAlert className="size-4 shrink-0 text-amber" aria-hidden />
                ) : (
                  <CircleCheck className="size-4 shrink-0 text-muted" aria-hidden />
                )}
                <span className="w-14 text-muted">{label}</span>
                {measurement.mean.toFixed(5).replace("-", "−")}
                <span className="text-xs text-muted">{over ? "Above limit" : "Within limit"}</span>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-2 text-[11px] text-faint">Mean of the {scopeLabel(time)}.</p>
    </Panel>
  );
}
