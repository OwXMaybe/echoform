"use client";

import { Crosshair, FilePlus2, X } from "lucide-react";
import { useRef, useState } from "react";
import { AUDIO_ACCEPT } from "@/components/shared/OpenFileButton";
import { Explained, IconButton, Segmented } from "@/components/shared/controls";
import {
  drawFrequencyAxes,
  frequencyPlotArea,
  tracePoints,
} from "@/core/visualization/frequency-plot";
import { CHART, CHART_FONT } from "@/core/visualization/plot";
import { linearTicks, type FrequencyAxis } from "@/core/visualization/scales";
import { useCanvasRenderer } from "@/hooks/use-canvas-renderer";
import { audioStore } from "@/stores/audio-store";
import {
  alignmentOffset,
  clearReference,
  comparisonStore,
  estimateAlignment,
  loadReference,
  setAlignment,
  setManualOffset,
  setNormalisation,
  type AlignmentMethod,
} from "@/stores/comparison-store";
import { useStore } from "@/stores/create-store";
import { settingsStore } from "@/stores/settings-store";
import type {
  ComparisonMetrics,
  ComparisonNormalisation,
  ComparisonResult,
  WaveformEnvelope,
} from "@/types/analysis";
import { formatDb, formatHz, formatTime, formatTimePrecise } from "@/utils/formatting";

const STORES = [comparisonStore, settingsStore];
const COLOR_A = CHART.channels[0];
const COLOR_B = CHART.channels[1];
const COLOR_DIFFERENCE = CHART.label;
const MIN_DIFFERENCE_SPAN_DB = 12;

const ALIGNMENT_OPTIONS: ReadonlyArray<{ value: AlignmentMethod; label: string }> = [
  { value: "start", label: "Align starts" },
  { value: "end", label: "Align ends" },
  { value: "manual", label: "Manual offset" },
];
const NORMALISATION_OPTIONS: ReadonlyArray<{ value: ComparisonNormalisation; label: string }> = [
  { value: "none", label: "None" },
  { value: "rms", label: "Match RMS" },
  { value: "peak", label: "Match peak" },
];

function ReferenceBar() {
  const input = useRef<HTMLInputElement>(null);
  const reference = useStore(comparisonStore, (s) => s.reference);
  const stage = useStore(comparisonStore, (s) => s.importStage);
  const error = useStore(comparisonStore, (s) => s.importError);
  const name = useStore(audioStore, (s) => s.recording?.original.name ?? "");
  return (
    <section className="space-y-1.5 border-b border-line px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="size-2.5 shrink-0 rounded-sm" style={{ background: COLOR_A }} aria-hidden />
          <span className="text-xs text-muted">A</span>
          <span className="truncate">{name}</span>
        </span>
        {reference && (
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="size-2.5 shrink-0 rounded-sm" style={{ background: COLOR_B }} aria-hidden />
            <span className="text-xs text-muted">B</span>
            <span className="truncate" data-testid="reference-name">
              {reference.name}
            </span>
            <IconButton label="Remove recording B" onClick={clearReference}>
              <X className="size-3.5" aria-hidden />
            </IconButton>
          </span>
        )}
        <input
          ref={input}
          type="file"
          accept={AUDIO_ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-label="Open recording to compare"
          data-testid="reference-input"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void loadReference(file);
          }}
        />
        <button
          type="button"
          onClick={() => input.current?.click()}
          className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-xs hover:bg-raised"
        >
          <FilePlus2 className="size-3.5" aria-hidden />
          {reference ? "Replace B" : "Open recording B"}
        </button>
        {stage && <span className="text-xs text-muted">{stage}…</span>}
      </div>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
      {reference?.warnings.map((warning) => (
        <p key={warning} className="text-xs text-amber">
          {warning}
        </p>
      ))}
    </section>
  );
}

function AlignmentControls() {
  const alignment = useStore(comparisonStore, (s) => s.alignment);
  const manualOffset = useStore(comparisonStore, (s) => s.manualOffset);
  const estimate = useStore(comparisonStore, (s) => s.estimate);
  const normalisation = useStore(comparisonStore, (s) => s.normalisation);
  const estimating = useStore(audioStore, (s) => s.status.offset === "running");
  const offset = useStore(comparisonStore, (s) =>
    alignmentOffset(s, audioStore.get().recording?.decoded.duration ?? 0),
  );
  return (
    <section className="space-y-1.5 border-b border-line px-3 py-2 text-xs text-muted">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <span className="flex items-center gap-2">
          Alignment
          <Segmented
            label="Alignment"
            value={alignment}
            options={ALIGNMENT_OPTIONS}
            onChange={setAlignment}
          />
        </span>
        {alignment === "manual" && (
          <label className="flex items-center gap-1.5">
            Offset (s)
            <input
              type="number"
              step={0.001}
              value={manualOffset}
              onChange={(event) => {
                const next = Number(event.target.value);
                if (Number.isFinite(next)) setManualOffset(next);
              }}
              className="w-24 rounded border border-line bg-raised px-1.5 py-1 tabular-nums text-ink"
            />
          </label>
        )}
        <button
          type="button"
          disabled={estimating}
          onClick={estimateAlignment}
          aria-pressed={alignment === "estimated"}
          className={`flex items-center gap-1 rounded-md border px-2 py-1 hover:bg-raised disabled:opacity-40 ${
            alignment === "estimated" ? "border-accent text-ink" : "border-line"
          }`}
        >
          <Crosshair className="size-3.5" aria-hidden />
          {estimating ? "Estimating…" : "Estimate offset"}
        </button>
        <span className="flex items-center gap-2">
          Normalise B
          <Segmented
            label="Normalise B"
            value={normalisation}
            options={NORMALISATION_OPTIONS}
            onChange={setNormalisation}
          />
        </span>
      </div>
      <div className="grid gap-x-6 sm:grid-cols-2">
        <Explained metric="alignment">
          <span data-testid="alignment-summary">
            {describeAlignment(alignment, offset)}
            {alignment === "estimated" && estimate && (
              <>
                {" "}
                Match{" "}
                {estimate.coefficient === null ? "undefined" : estimate.coefficient.toFixed(3)},
                resolved to {(estimate.resolutionSeconds * 1000).toFixed(3)} ms.
              </>
            )}
          </span>
        </Explained>
        <Explained metric="normalisation">
          <span>About normalisation</span>
        </Explained>
      </div>
    </section>
  );
}

function describeAlignment(method: AlignmentMethod, offset: number): string {
  const seconds = Math.abs(offset).toFixed(3);
  const relation =
    offset === 0 ? "B starts with A." : offset > 0 ? `B starts ${seconds} s into A.` : `A starts ${seconds} s into B.`;
  const name = {
    start: "File starts",
    end: "File ends",
    manual: "Manual offset",
    estimated: "Cross-correlation estimate",
  }[method];
  return `${name}: ${relation}`;
}

const number = (value: number | null, digits = 2) =>
  value === null ? "Not defined" : value.toFixed(digits).replace("-", "−");
const hz = (value: number | null) => (value === null ? "Not defined" : formatHz(value));
function signed(value: number, digits = 2): string {
  const magnitude = Math.abs(value).toFixed(digits);
  if (Number(magnitude) === 0) return magnitude;
  return `${value > 0 ? "+" : "−"}${magnitude}`;
}

interface MetricRow {
  label: string;
  value: (m: ComparisonMetrics) => string;
  raw: (m: ComparisonMetrics) => number | null;
  unit?: string;
  digits?: number;
}

const METRIC_ROWS: MetricRow[] = [
  { label: "Duration", value: (m) => `${m.duration.toFixed(3)} s`, raw: (m) => m.duration, unit: "s", digits: 3 },
  { label: "Sample rate", value: (m) => `${m.sampleRate} Hz`, raw: (m) => m.sampleRate, unit: "Hz", digits: 0 },
  { label: "Channels", value: (m) => String(m.channelCount), raw: (m) => m.channelCount, digits: 0 },
  { label: "Peak level", value: (m) => formatDb(m.peakDb), raw: (m) => m.peakDb, unit: "dB" },
  { label: "RMS level", value: (m) => formatDb(m.rmsDb), raw: (m) => m.rmsDb, unit: "dB" },
  { label: "Crest factor", value: (m) => formatDb(m.crestDb, "dB"), raw: (m) => m.crestDb, unit: "dB" },
  { label: "Short-term range", value: (m) => formatDb(m.dynamicRangeDb, "dB"), raw: (m) => m.dynamicRangeDb, unit: "dB" },
  { label: "Spectral centroid", value: (m) => hz(m.centroidHz), raw: (m) => m.centroidHz, unit: "Hz", digits: 0 },
  { label: "Spectral rolloff", value: (m) => hz(m.rolloffHz), raw: (m) => m.rolloffHz, unit: "Hz", digits: 0 },
  { label: "Spectral flatness", value: (m) => number(m.flatness, 3), raw: (m) => m.flatness, digits: 3 },
  { label: "Zero-crossing rate", value: (m) => (m.zeroCrossingRate === null ? "Not defined" : `${m.zeroCrossingRate.toFixed(0)} /s`), raw: (m) => m.zeroCrossingRate, unit: "/s", digits: 0 },
  { label: "Channel correlation", value: (m) => number(m.correlation, 3), raw: (m) => m.correlation, digits: 3 },
];

function MetricsTable({ result }: { result: ComparisonResult }) {
  return (
    <section className="border-b border-line px-3 py-3">
      <h2 className="text-xs font-medium text-muted">Measurements</h2>
      <div className="overflow-x-auto">
        <table className="mt-1 w-full min-w-96 text-sm tabular-nums" data-testid="comparison-table">
          <thead>
            <tr className="text-left text-xs text-faint">
              <th className="py-1 font-normal">Metric</th>
              <th className="py-1 text-right font-normal">A</th>
              <th className="py-1 text-right font-normal">B</th>
              <th className="py-1 text-right font-normal">B − A</th>
            </tr>
          </thead>
          <tbody>
            {METRIC_ROWS.map((row) => {
              const a = row.raw(result.a);
              const b = row.raw(result.b);
              return (
                <tr key={row.label} className="border-t border-line">
                  <td className="py-1">{row.label}</td>
                  <td className="py-1 text-right">{row.value(result.a)}</td>
                  <td className="py-1 text-right">{row.value(result.b)}</td>
                  <td className="py-1 text-right text-muted">
                    {a === null || b === null
                      ? "—"
                      : `${signed(b - a, row.digits ?? 2)}${row.unit ? ` ${row.unit}` : ""}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-1.5 text-xs text-faint">
        Peak is the largest of any channel and RMS is the mean power across channels. Spectral
        figures, zero crossings and short-term range use each recording&apos;s channel mix. Metrics
        are never normalised. Correlation is only defined for stereo.
      </p>
    </section>
  );
}

function spectrumAxis(result: ComparisonResult): FrequencyAxis {
  return {
    min: result.gridHz[0],
    max: result.gridHz[result.gridHz.length - 1],
    scale: settingsStore.get().frequencyScale,
  };
}

function SpectrumOverlay() {
  const canvas = useRef<HTMLCanvasElement>(null);
  useCanvasRenderer(
    canvas,
    (ctx, width, height) => {
      ctx.fillStyle = CHART.background;
      ctx.fillRect(0, 0, width, height);
      const { result } = comparisonStore.get();
      if (!result) return;
      const area = frequencyPlotArea(width, height);
      const axis = spectrumAxis(result);
      const toY = drawFrequencyAxes(
        ctx,
        area,
        axis,
        -settingsStore.get().dynamicRangeDb,
        0,
        "Level (dB, band average)",
      );
      const scaledB = result.levelB.map((db) => db + result.gainDb);
      ctx.save();
      ctx.beginPath();
      ctx.rect(area.left, area.top, area.width, area.height);
      ctx.clip();
      ctx.lineJoin = "round";
      ctx.lineWidth = 2;
      tracePoints(ctx, area, axis, result.gridHz, result.levelA, toY);
      ctx.strokeStyle = COLOR_A;
      ctx.stroke();
      tracePoints(ctx, area, axis, result.gridHz, scaledB, toY);
      ctx.strokeStyle = COLOR_B;
      ctx.stroke();
      ctx.restore();
    },
    { stores: STORES, dependencies: () => [comparisonStore.get().result, settingsStore.get().frequencyScale, settingsStore.get().dynamicRangeDb] },
  );
  return (
    <figure className="m-0 border-b border-line">
      <figcaption className="flex flex-wrap items-center gap-x-4 px-3 pt-2 text-xs text-muted">
        <span>Spectra</span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4" style={{ background: COLOR_A }} aria-hidden />A
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4" style={{ background: COLOR_B }} aria-hidden />B
        </span>
      </figcaption>
      <div role="img" aria-label="Overlaid spectra of A and B" className="relative h-64">
        <canvas ref={canvas} className="absolute inset-0 h-full w-full" data-testid="comparison-spectrum" />
      </div>
    </figure>
  );
}

function SpectralDifference() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const tooltip = useRef<HTMLDivElement>(null);
  useCanvasRenderer(
    canvas,
    (ctx, width, height) => {
      ctx.fillStyle = CHART.background;
      ctx.fillRect(0, 0, width, height);
      const { result } = comparisonStore.get();
      if (!result) return;
      const difference = result.levelB.map((db, i) => db + result.gainDb - result.levelA[i]);
      let span = MIN_DIFFERENCE_SPAN_DB;
      for (const value of difference) {
        if (Math.abs(value) > span && Math.abs(value) < 200) span = Math.abs(value);
      }
      span = Math.min(96, Math.ceil(span / 6) * 6);
      const area = frequencyPlotArea(width, height);
      const axis = spectrumAxis(result);
      const toY = drawFrequencyAxes(ctx, area, axis, -span, span, "B − A (dB)", 4);
      ctx.save();
      ctx.beginPath();
      ctx.rect(area.left, area.top, area.width, area.height);
      ctx.clip();
      tracePoints(ctx, area, axis, result.gridHz, difference, toY);
      ctx.strokeStyle = COLOR_DIFFERENCE;
      ctx.lineWidth = 2;
      ctx.lineJoin = "round";
      ctx.stroke();
      ctx.restore();
    },
    { stores: STORES, dependencies: () => [comparisonStore.get().result, settingsStore.get().frequencyScale] },
  );
  return (
    <figure className="m-0 border-b border-line">
      <figcaption className="px-3 pt-2 text-xs text-muted">
        <Explained metric="spectralDifference">
          <span>Spectral difference, B relative to A</span>
        </Explained>
      </figcaption>
      <div
        role="img"
        aria-label="Spectral difference between B and A"
        className="relative h-44 touch-none"
        onPointerLeave={() => {
          if (tooltip.current) tooltip.current.hidden = true;
        }}
        onPointerMove={(event) => {
          const { result } = comparisonStore.get();
          const element = tooltip.current;
          if (!result || !element) return;
          const rect = event.currentTarget.getBoundingClientRect();
          const area = frequencyPlotArea(rect.width, rect.height);
          const x = event.clientX - rect.left;
          const fraction = (x - area.left) / area.width;
          if (fraction < 0 || fraction > 1) {
            element.hidden = true;
            return;
          }
          const axis = spectrumAxis(result);
          const target =
            axis.scale === "log"
              ? axis.min * Math.pow(axis.max / axis.min, fraction)
              : axis.min + fraction * (axis.max - axis.min);
          let index = result.gridHz.findIndex((f) => f >= target);
          if (index < 0) index = result.gridHz.length - 1;
          const value = result.levelB[index] + result.gainDb - result.levelA[index];
          element.hidden = false;
          element.textContent = `${formatHz(result.gridHz[index])}  ·  ${signed(value)} dB`;
          const left = x > rect.width - 170 ? x - 160 : x + 12;
          element.style.transform = `translate(${left}px, 6px)`;
        }}
      >
        <canvas ref={canvas} className="absolute inset-0 h-full w-full" />
        <div
          ref={tooltip}
          hidden
          className="pointer-events-none absolute left-0 top-0 whitespace-pre rounded border border-line bg-deep/95 px-1.5 py-0.5 text-[11px] tabular-nums"
        />
      </div>
    </figure>
  );
}

function drawEnvelopeLane(
  ctx: CanvasRenderingContext2D,
  envelope: WaveformEnvelope,
  left: number,
  width: number,
  top: number,
  height: number,
  color: string,
): void {
  const mid = top + height / 2;
  const scale = height / 2 - 2;
  ctx.fillStyle = CHART.zero;
  ctx.fillRect(left, Math.round(mid), width, 1);
  ctx.fillStyle = color;
  const columns = envelope.min.length;
  for (let x = 0; x < width; x++) {
    const c0 = Math.floor((x / width) * columns);
    const c1 = Math.max(c0 + 1, Math.floor(((x + 1) / width) * columns));
    let lo = Infinity;
    let hi = -Infinity;
    for (let c = c0; c < c1; c++) {
      if (envelope.min[c] < lo) lo = envelope.min[c];
      if (envelope.max[c] > hi) hi = envelope.max[c];
    }
    const y0 = mid - Math.min(1.2, hi) * scale;
    const y1 = mid - Math.max(-1.2, lo) * scale;
    ctx.fillRect(left + x, y0, 1, Math.max(1, y1 - y0));
  }
}

const WAVE_LEFT = 52;
const WAVE_RIGHT = 14;
const WAVE_BOTTOM = 24;

function WaveformComparison({ showDifference }: { showDifference: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useCanvasRenderer(
    canvas,
    (ctx, width, height) => {
      ctx.fillStyle = CHART.background;
      ctx.fillRect(0, 0, width, height);
      const { result } = comparisonStore.get();
      if (!result) return;
      const lanes: Array<[string, WaveformEnvelope, string]> = [
        ["A", result.waveformA, COLOR_A],
        ["B", result.waveformB, COLOR_B],
      ];
      if (showDifference && result.difference) {
        lanes.push(["A − B", result.difference, COLOR_DIFFERENCE]);
      }
      const plotWidth = Math.max(1, Math.round(width - WAVE_LEFT - WAVE_RIGHT));
      const laneHeight = (height - WAVE_BOTTOM) / lanes.length;
      ctx.font = CHART_FONT;
      lanes.forEach(([label, envelope, color], index) => {
        const top = index * laneHeight;
        drawEnvelopeLane(ctx, envelope, WAVE_LEFT, plotWidth, top, laneHeight, color);
        ctx.fillStyle = CHART.label;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(label, 4, top + laneHeight / 2);
      });
      const { startA, seconds } = result;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = CHART.label;
      const y = height - WAVE_BOTTOM + 6;
      const count = Math.max(2, Math.floor(plotWidth / 110));
      for (const t of linearTicks(startA, startA + seconds, count)) {
        const x = WAVE_LEFT + ((t - startA) / seconds) * plotWidth;
        const nearEnd = WAVE_LEFT + plotWidth - x < 24;
        ctx.textAlign = nearEnd ? "right" : "center";
        ctx.fillText(formatTime(t, seconds), nearEnd ? WAVE_LEFT + plotWidth + 12 : x, y);
      }
    },
    { stores: STORES, dependencies: () => [comparisonStore.get().result, showDifference] },
  );
  return (
    <div
      role="img"
      aria-label="Waveforms of A and B over the compared interval"
      className={`relative ${showDifference ? "h-64" : "h-44"}`}
    >
      <canvas ref={canvas} className="absolute inset-0 h-full w-full" data-testid="comparison-waveform" />
    </div>
  );
}

function ComparisonCharts({ result }: { result: ComparisonResult }) {
  const [showDifference, setShowDifference] = useState(false);
  const canDiff = result.difference !== null;
  return (
    <>
      <section className="border-b border-line">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 pt-2 text-xs text-muted">
          <span>Waveforms on A&apos;s timeline</span>
          <label className={`flex items-center gap-1.5 ${canDiff ? "" : "text-faint"}`}>
            <input
              type="checkbox"
              disabled={!canDiff}
              checked={canDiff && showDifference}
              onChange={(event) => setShowDifference(event.target.checked)}
            />
            Show difference
          </label>
          {canDiff && showDifference && (
            <span className="tabular-nums" data-testid="difference-level">
              Residual {result.differenceRmsDb === null ? "none: the signals cancel exactly" : formatDb(result.differenceRmsDb)}
            </span>
          )}
          {!canDiff && (
            <span className="text-faint">
              The sample rates differ, so samples do not correspond and no difference is computed.
            </span>
          )}
          {canDiff && (
            <div className="ml-auto">
              <Explained metric="waveformDifference">
                <span>About</span>
              </Explained>
            </div>
          )}
        </div>
        <WaveformComparison showDifference={canDiff && showDifference} />
      </section>
      <SpectrumOverlay />
      <SpectralDifference />
    </>
  );
}

export function ComparisonLab() {
  const reference = useStore(comparisonStore, (s) => s.reference);
  const result = useStore(comparisonStore, (s) => s.result);
  const noOverlap = useStore(comparisonStore, (s) => s.noOverlap);
  const running = useStore(audioStore, (s) => s.status.compare === "running");
  const progress = useStore(audioStore, (s) => s.progress.compare);
  return (
    <div>
      <ReferenceBar />
      {!reference ? (
        <p className="p-4 text-sm text-muted">
          Open a second recording to compare it with the current one. It stays in this browser tab
          and is not saved or uploaded.
        </p>
      ) : (
        <>
          <AlignmentControls />
          {noOverlap && (
            <p className="p-4 text-sm text-amber" role="status" data-testid="no-overlap">
              The recordings do not overlap under this alignment, so there is nothing to compare.
            </p>
          )}
          {result && (
            <>
              <p className="border-b border-line px-3 py-1.5 text-xs tabular-nums text-faint" data-testid="comparison-scope">
                Comparing {formatTimePrecise(result.seconds)} of overlap: A from{" "}
                {formatTimePrecise(result.startA)}, B from {formatTimePrecise(result.startB)}.
                {result.normalisation !== "none" &&
                  ` B scaled by ${signed(result.gainDb)} dB in the charts.`}
                {" "}Spectra stop at {formatHz(result.gridHz[result.gridHz.length - 1])}.
              </p>
              <MetricsTable result={result} />
              <ComparisonCharts result={result} />
            </>
          )}
          {!result && !noOverlap && running && (
            <p className="p-4 text-sm text-muted">Comparing… {Math.round(progress * 100)}%</p>
          )}
        </>
      )}
    </div>
  );
}
