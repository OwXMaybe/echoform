"use client";

import { useRef } from "react";
import { frequencyToNote, MAX_PITCH_HZ, MIN_PITCH_HZ } from "@/core/dsp/pitch";
import {
  CHART,
  CHART_FONT,
  drawTimeAxis,
  drawTimeOverlay,
  timePlotArea,
  timeToX,
} from "@/core/visualization/plot";
import { useCanvasRenderer } from "@/hooks/use-canvas-renderer";
import { useTimelineInteraction, type HoverPoint } from "@/hooks/use-timeline-interaction";
import { useStore } from "@/stores/create-store";
import { insightsStore } from "@/stores/insights-store";
import { playback, playbackStore } from "@/stores/playback-store";
import { selectionStore } from "@/stores/selection-store";
import { formatHz, formatTimePrecise } from "@/utils/formatting";

const BASE_STORES = [selectionStore, insightsStore];
const OVERLAY_STORES = [selectionStore, playbackStore];
const PITCH_TICKS = [100, 200, 500, 1000, 2000];

const clipTo = (ctx: CanvasRenderingContext2D, area: ReturnType<typeof timePlotArea>) => {
  ctx.save();
  ctx.beginPath();
  ctx.rect(area.left, area.top, area.width, area.height);
  ctx.clip();
};

/** A canvas pair sharing the waveform's time axis, click-to-seek and selection. */
function TimeChart({
  draw,
  describe,
  label,
  testId,
}: {
  draw: (ctx: CanvasRenderingContext2D, width: number, height: number) => void;
  describe: (point: HoverPoint) => string | null;
  label: string;
  testId: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const base = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const tooltip = useRef<HTMLDivElement>(null);
  const isPlaying = useStore(playbackStore, (s) => s.isPlaying);

  useCanvasRenderer(base, draw, { stores: BASE_STORES });
  useCanvasRenderer(
    overlay,
    (ctx, width, height) => {
      ctx.clearRect(0, 0, width, height);
      const { view, time } = selectionStore.get();
      if (view.end <= view.start) return;
      drawTimeOverlay(ctx, timePlotArea(width, height), view, time, playback.position());
    },
    { stores: OVERLAY_STORES, animate: isPlaying },
  );
  useTimelineInteraction(container, {
    onHover: (point) => {
      const element = tooltip.current;
      if (!element) return;
      const text = point ? describe(point) : null;
      element.hidden = !text;
      if (!point || !text) return;
      element.textContent = text;
      const width = container.current?.clientWidth ?? 0;
      element.style.transform = `translate(${Math.min(point.x + 12, width - 190)}px, 8px)`;
    },
  });
  return (
    <div
      ref={container}
      role="img"
      aria-label={label}
      data-testid={testId}
      className="relative h-36 cursor-crosshair touch-none select-none overflow-hidden"
    >
      <canvas ref={base} className="absolute inset-0 h-full w-full" />
      <canvas ref={overlay} className="absolute inset-0 h-full w-full" />
      <div
        ref={tooltip}
        hidden
        className="pointer-events-none absolute left-0 top-0 whitespace-pre rounded border border-line bg-deep/95 px-1.5 py-0.5 text-[11px] tabular-nums"
      />
    </div>
  );
}

export function NoveltyChart() {
  const draw = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
    ctx.fillStyle = CHART.background;
    ctx.fillRect(0, 0, width, height);
    const { novelty, threshold, onsets } = insightsStore.get();
    const { view } = selectionStore.get();
    if (view.end <= view.start) return;
    const area = timePlotArea(width, height);
    drawTimeAxis(ctx, area, view);
    ctx.font = CHART_FONT;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillStyle = CHART.label;
    ctx.fillText("1", area.left - 6, area.top + 6);
    ctx.fillText("0", area.left - 6, area.top + area.height - 6);
    if (!novelty) return;
    const { hopSeconds, frameOffsetSeconds } = novelty;
    const toY = (value: number) => area.top + (1 - value) * area.height;
    const peaks = new Float32Array(Math.ceil(area.width) + 1);
    const limits = new Float32Array(peaks.length);
    for (let px = 0; px < peaks.length; px++) {
      const t0 = view.start + (px / area.width) * (view.end - view.start) - frameOffsetSeconds;
      const t1 = view.start + ((px + 1) / area.width) * (view.end - view.start) - frameOffsetSeconds;
      const from = Math.max(0, Math.floor(t0 / hopSeconds));
      const to = Math.min(novelty.novelty.length, Math.max(from + 1, Math.ceil(t1 / hopSeconds)));
      for (let f = from; f < to; f++) {
        if (novelty.novelty[f] > peaks[px]) peaks[px] = novelty.novelty[f];
        if (threshold && threshold[f] > limits[px]) limits[px] = threshold[f];
      }
    }
    clipTo(ctx, area);
    ctx.fillStyle = CHART.channels[0];
    peaks.forEach((value, px) => {
      ctx.fillRect(area.left + px, toY(value), 1, value * area.height);
    });
    ctx.strokeStyle = CHART.playhead;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    limits.forEach((value, px) => {
      if (px === 0) ctx.moveTo(area.left, toY(value));
      else ctx.lineTo(area.left + px, toY(value));
    });
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = CHART.clipping;
    for (const { time } of onsets) {
      if (time < view.start || time > view.end) continue;
      ctx.fillRect(Math.round(timeToX(time, view, area)) - 1, area.top, 3, 5);
    }
    ctx.restore();
  };
  const describe = (point: HoverPoint) => {
    const { novelty } = insightsStore.get();
    if (!novelty) return null;
    const frame = Math.round((point.time - novelty.frameOffsetSeconds) / novelty.hopSeconds);
    const value = novelty.novelty[frame];
    return value === undefined
      ? null
      : `${formatTimePrecise(point.time)}  ·  strength ${value.toFixed(2)}`;
  };
  return <TimeChart draw={draw} describe={describe} label="Onset strength over time" testId="novelty-chart" />;
}

const pitchFraction = (hz: number) =>
  Math.log(hz / MIN_PITCH_HZ) / Math.log(MAX_PITCH_HZ / MIN_PITCH_HZ);

export function PitchChart() {
  const draw = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
    ctx.fillStyle = CHART.background;
    ctx.fillRect(0, 0, width, height);
    const { pitch } = insightsStore.get();
    const { view } = selectionStore.get();
    if (view.end <= view.start) return;
    const area = timePlotArea(width, height);
    const toY = (hz: number) => area.top + (1 - pitchFraction(hz)) * area.height;
    ctx.font = CHART_FONT;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (const hz of PITCH_TICKS) {
      const y = Math.round(toY(hz));
      ctx.fillStyle = CHART.grid;
      ctx.fillRect(area.left, y, area.width, 1);
      ctx.fillStyle = CHART.label;
      ctx.fillText(hz >= 1000 ? `${hz / 1000}k` : String(hz), area.left - 6, y);
    }
    drawTimeAxis(ctx, area, view);
    if (!pitch) return;
    const { frequency, hopSeconds, startSeconds } = pitch;
    const first = Math.max(0, Math.floor((view.start - startSeconds) / hopSeconds));
    const last = Math.min(frequency.length - 1, Math.ceil((view.end - startSeconds) / hopSeconds));
    clipTo(ctx, area);
    ctx.fillStyle = CHART.spectrum;
    const dot = Math.max(1.5, Math.min(3, (hopSeconds / (view.end - view.start)) * area.width));
    for (let f = first; f <= last; f++) {
      const hz = frequency[f];
      if (Number.isNaN(hz)) continue;
      const x = timeToX(startSeconds + f * hopSeconds, view, area);
      ctx.fillRect(x, toY(hz) - dot / 2, dot, dot);
    }
    ctx.restore();
  };
  const describe = (point: HoverPoint) => {
    const { pitch } = insightsStore.get();
    if (!pitch) return null;
    const frame = Math.round((point.time - pitch.startSeconds) / pitch.hopSeconds);
    const hz = pitch.frequency[frame];
    if (hz === undefined) return null;
    const time = formatTimePrecise(point.time);
    if (Number.isNaN(hz)) return `${time}  ·  no reliable pitch`;
    const note = frequencyToNote(hz);
    const cents = `${note.cents >= 0 ? "+" : "−"}${Math.abs(note.cents).toFixed(0)}`;
    return `${time}  ·  ${formatHz(hz)}  ·  ${note.name} ${cents}¢`;
  };
  return <TimeChart draw={draw} describe={describe} label="Pitch track over time" testId="pitch-chart" />;
}
