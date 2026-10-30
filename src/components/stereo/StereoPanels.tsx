"use client";

import { useRef } from "react";
import { Explained } from "@/components/shared/controls";
import { colorMapLut } from "@/core/visualization/color-maps";
import { CHART, CHART_FONT } from "@/core/visualization/plot";
import { useCanvasRenderer } from "@/hooks/use-canvas-renderer";
import { audioStore } from "@/stores/audio-store";
import { useStore } from "@/stores/create-store";
import { selectionStore } from "@/stores/selection-store";
import type { StereoResult } from "@/types/analysis";
import { formatDb, formatTime } from "@/utils/formatting";

const STORES = [audioStore];

/** Index of a selection-free phrase for what a correlation value suggests. */
function correlationReading(r: number): string {
  if (r > 0.9) return "The channels are nearly identical in shape, so the signal is close to mono.";
  if (r > 0.3) return "The channels are related, with a shared centre and some differences.";
  if (r > -0.3) return "The channels are largely unrelated, so there is no strong shared shape.";
  if (r > -0.9) return "The channels partly oppose each other, so a mono mix will lose level.";
  return "The channels are nearly inverted, so most of the signal cancels in a mono mix.";
}

function CorrelationMeter({ value }: { value: number | null }) {
  return (
    <section className="border-b border-line px-3 py-3">
      <Explained metric="correlation">
        <h2 className="text-xs font-medium text-muted">Channel correlation</h2>
      </Explained>
      {value === null ? (
        <p className="mt-1 text-sm text-muted">
          Not defined here: at least one channel is silent over this range.
        </p>
      ) : (
        <>
          <p className="mt-1 text-2xl font-semibold tabular-nums" data-testid="correlation">
            {value >= 0 ? "+" : "−"}
            {Math.abs(value).toFixed(3)}
          </p>
          <div
            role="meter"
            aria-label="Channel correlation"
            aria-valuemin={-1}
            aria-valuemax={1}
            aria-valuenow={value}
            className="relative mt-2 h-2 rounded bg-raised"
          >
            <span className="absolute inset-y-0 left-1/2 w-px bg-faint" />
            <span
              className="absolute -top-1 h-4 w-1 -translate-x-1/2 rounded bg-accent"
              style={{ left: `${((value + 1) / 2) * 100}%` }}
            />
          </div>
          <div className="mt-1 flex justify-between text-[11px] text-faint">
            <span>−1 inverted</span>
            <span>0 unrelated</span>
            <span>+1 identical</span>
          </div>
          <p className="mt-2 text-xs text-muted">{correlationReading(value)}</p>
        </>
      )}
      <p className="mt-1 text-xs text-faint">
        One number cannot describe a stereo image. Delay, panning and reverb can all give similar
        values.
      </p>
    </section>
  );
}

function LevelTable({ stereo }: { stereo: StereoResult }) {
  const rows = [
    ["Left", stereo.leftRmsDb, stereo.leftPeakDb],
    ["Right", stereo.rightRmsDb, stereo.rightPeakDb],
    ["Mid", stereo.midRmsDb, stereo.midPeakDb],
    ["Side", stereo.sideRmsDb, stereo.sidePeakDb],
  ] as const;
  return (
    <section className="border-b border-line px-3 py-3">
      <Explained metric="midSide">
        <h2 className="text-xs font-medium text-muted">Levels</h2>
      </Explained>
      <table className="mt-1 w-full text-sm tabular-nums">
        <thead>
          <tr className="text-left text-xs text-faint">
            <th className="py-1 font-normal">Signal</th>
            <th className="py-1 text-right font-normal">RMS</th>
            <th className="py-1 text-right font-normal">Peak</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, rms, peak]) => (
            <tr key={label} className="border-t border-line">
              <td className="py-1">{label}</td>
              <td className="py-1 text-right">{formatDb(rms)}</td>
              <td className="py-1 text-right">{formatDb(peak)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1.5 text-xs text-faint">
        Mid = (L + R) / 2 and Side = (L − R) / 2, on the same dBFS scale as the channels.
      </p>
    </section>
  );
}

function SummaryFigures({ stereo }: { stereo: StereoResult }) {
  return (
    <section className="grid gap-3 border-b border-line px-3 py-3 sm:grid-cols-3">
      <Explained metric="levelDifference">
        <div>
          <p className="text-xs text-muted">Level difference (L − R)</p>
          <p className="text-sm tabular-nums">{formatDb(stereo.levelDifferenceDb, "dB")}</p>
        </div>
      </Explained>
      <Explained metric="stereoWidth">
        <div>
          <p className="text-xs text-muted">Width index</p>
          <p className="text-sm tabular-nums" data-testid="width">
            {stereo.width === null ? "No signal" : stereo.width.toFixed(3)}
          </p>
        </div>
      </Explained>
      <div>
        <p className="text-xs text-muted">Side relative to mid</p>
        <p className="text-sm tabular-nums">
          {stereo.sideToMidDb === null ? "Not defined" : formatDb(stereo.sideToMidDb, "dB")}
        </p>
      </div>
    </section>
  );
}

function Vectorscope() {
  const canvas = useRef<HTMLCanvasElement>(null);
  useCanvasRenderer(
    canvas,
    (ctx, width, height) => {
      ctx.fillStyle = CHART.background;
      ctx.fillRect(0, 0, width, height);
      const stereo = audioStore.get().stereo;
      if (!stereo) return;
      const size = stereo.vectorscopeSize;
      const image = new ImageData(size, size);
      const pixels = new Uint32Array(image.data.buffer);
      const lut = colorMapLut("magma");
      const peak = Math.max(1, ...stereo.vectorscope);
      const scale = (lut.length - 1) / Math.log1p(peak);
      for (let y = 0; y < size; y++) {
        const row = (size - 1 - y) * size;
        for (let x = 0; x < size; x++) {
          const count = stereo.vectorscope[row + x];
          if (count > 0) pixels[y * size + x] = lut[Math.round(Math.log1p(count) * scale)];
        }
      }
      const offscreen = new OffscreenCanvas(size, size);
      offscreen.getContext("2d")?.putImageData(image, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(offscreen, 0, 0, width, height);

      ctx.fillStyle = CHART.zero;
      ctx.fillRect(Math.round(width / 2), 0, 1, height);
      ctx.fillRect(0, Math.round(height / 2), width, 1);
      ctx.font = CHART_FONT;
      ctx.fillStyle = CHART.label;
      ctx.textBaseline = "top";
      ctx.textAlign = "center";
      ctx.fillText("Mono", width / 2, 4);
      ctx.textAlign = "left";
      ctx.fillText("R", 6, 4);
      ctx.textAlign = "right";
      ctx.fillText("L", width - 6, 4);
      ctx.textBaseline = "middle";
      ctx.fillText("Out of phase", width - 6, height / 2 - 9);
    },
    { stores: STORES, dependencies: () => [audioStore.get().stereo] },
  );
  return (
    <div
      role="img"
      aria-label="Vectorscope of side against mid for every sample in the range"
      className="mx-auto aspect-square w-full max-w-64"
    >
      <canvas ref={canvas} className="h-full w-full rounded" />
    </div>
  );
}

const TOP = 8;
const BOTTOM = 24;
const LEFT = 44;
const RIGHT = 12;

function CorrelationTimeline() {
  const container = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const tooltip = useRef<HTMLDivElement>(null);
  useCanvasRenderer(
    canvas,
    (ctx, width, height) => {
      ctx.fillStyle = CHART.background;
      ctx.fillRect(0, 0, width, height);
      const stereo = audioStore.get().stereo;
      if (!stereo) return;
      const series = stereo.correlationOverTime;
      const plotWidth = Math.max(1, width - LEFT - RIGHT);
      const plotHeight = Math.max(1, height - TOP - BOTTOM);
      const toY = (r: number) => TOP + ((1 - r) / 2) * plotHeight;
      ctx.font = CHART_FONT;
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      for (const r of [-1, 0, 1]) {
        ctx.fillStyle = r === 0 ? CHART.zero : CHART.grid;
        ctx.fillRect(LEFT, Math.round(toY(r)), plotWidth, 1);
        ctx.fillStyle = CHART.label;
        ctx.fillText(r < 0 ? "−1" : r > 0 ? "+1" : "0", LEFT - 6, toY(r));
      }
      if (series.length === 0) return;
      const start = selectionStore.get().time?.start ?? 0;
      const span = series.length * stereo.correlationBlockSeconds;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = CHART.label;
      for (const fraction of [0, 0.5, 1]) {
        const x = LEFT + fraction * plotWidth;
        ctx.fillText(formatTime(start + fraction * span, span), x, TOP + plotHeight + 6);
      }
      ctx.strokeStyle = CHART.spectrum;
      ctx.lineWidth = 2;
      ctx.lineJoin = "round";
      ctx.beginPath();
      let drawing = false;
      series.forEach((r, i) => {
        // A gap, not a zero: correlation does not exist where a channel is silent.
        if (Number.isNaN(r)) {
          drawing = false;
          return;
        }
        const x = LEFT + ((i + 0.5) / series.length) * plotWidth;
        if (drawing) ctx.lineTo(x, toY(r));
        else ctx.moveTo(x, toY(r));
        drawing = true;
      });
      ctx.stroke();
    },
    { stores: STORES, dependencies: () => [audioStore.get().stereo] },
  );
  return (
    <figure className="m-0 border-b border-line">
      <figcaption className="px-3 pt-2 text-xs text-muted">
        Correlation over time, in 100 ms blocks. Gaps mean a channel is silent.
      </figcaption>
      <div
        ref={container}
        role="img"
        aria-label="Channel correlation over time"
        className="relative h-40 touch-none"
        onPointerLeave={() => {
          if (tooltip.current) tooltip.current.hidden = true;
        }}
        onPointerMove={(event) => {
          const stereo = audioStore.get().stereo;
          const element = tooltip.current;
          if (!stereo || !element) return;
          const rect = event.currentTarget.getBoundingClientRect();
          const x = event.clientX - rect.left;
          const fraction = (x - LEFT) / (rect.width - LEFT - RIGHT);
          const series = stereo.correlationOverTime;
          if (fraction < 0 || fraction >= 1 || series.length === 0) {
            element.hidden = true;
            return;
          }
          const index = Math.floor(fraction * series.length);
          const start = selectionStore.get().time?.start ?? 0;
          const time = start + index * stereo.correlationBlockSeconds;
          const value = series[index];
          element.hidden = false;
          element.textContent = `${formatTime(time, 1)}  ·  ${
            Number.isNaN(value) ? "Not defined" : value.toFixed(3).replace("-", "−")
          }`;
          const left = x > rect.width - 150 ? x - 140 : x + 12;
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

export function StereoPanels() {
  const channels = useStore(audioStore, (s) => s.recording?.decoded.channelCount ?? 0);
  const stereo = useStore(audioStore, (s) => s.stereo);
  const hasSelection = useStore(selectionStore, (s) => s.time !== null);

  if (channels !== 2) {
    return (
      <p className="p-4 text-sm text-muted" data-testid="stereo-unavailable">
        This recording has {channels === 1 ? "one channel" : `${channels} channels`}. Stereo
        measurements need exactly two, so none are shown.
      </p>
    );
  }
  if (!stereo) return <p className="p-4 text-sm text-muted">Measuring…</p>;

  return (
    <div>
      <p className="border-b border-line px-3 py-1.5 text-xs text-faint">
        Measured over {hasSelection ? "the selected time range" : "the whole recording"}.
      </p>
      <div className="grid md:grid-cols-2">
        <div className="md:border-r md:border-line">
          <CorrelationMeter value={stereo.correlation} />
          <LevelTable stereo={stereo} />
        </div>
        <section className="border-b border-line px-3 py-3">
          <Explained metric="vectorscope">
            <h2 className="text-xs font-medium text-muted">Vectorscope</h2>
          </Explained>
          <div className="mt-2">
            <Vectorscope />
          </div>
        </section>
      </div>
      <SummaryFigures stereo={stereo} />
      <CorrelationTimeline />
    </div>
  );
}
