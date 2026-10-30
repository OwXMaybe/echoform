"use client";

import { useRef } from "react";
import { selectLevel } from "@/core/dsp/waveform";
import {
  CHART,
  CHART_FONT,
  drawTimeAxis,
  drawTimeOverlay,
  timePlotArea,
  timeToX,
  type PlotArea,
} from "@/core/visualization/plot";
import { useCanvasRenderer } from "@/hooks/use-canvas-renderer";
import { useTimelineInteraction, type HoverPoint } from "@/hooks/use-timeline-interaction";
import { audioStore, getAudioBuffer } from "@/stores/audio-store";
import { useStore } from "@/stores/create-store";
import { insightsStore } from "@/stores/insights-store";
import { playback, playbackStore } from "@/stores/playback-store";
import { selectionStore, type TimeRange } from "@/stores/selection-store";
import type { WaveformPyramid } from "@/types/analysis";
import { formatAmplitude, formatTimePrecise } from "@/utils/formatting";

const BASE_STORES = [selectionStore, audioStore];
const OVERLAY_STORES = [selectionStore, playbackStore, audioStore, insightsStore];

function drawLane(
  ctx: CanvasRenderingContext2D,
  samples: Float32Array,
  pyramid: WaveformPyramid | undefined,
  sampleRate: number,
  view: TimeRange,
  area: PlotArea,
  laneTop: number,
  laneHeight: number,
  color: string,
  dpr: number,
): void {
  const mid = laneTop + laneHeight / 2;
  const scale = laneHeight / 2 - 2;
  const columns = Math.round(area.width * dpr);
  const samplesPerColumn = ((view.end - view.start) * sampleRate) / columns;
  const startSample = view.start * sampleRate;
  ctx.fillStyle = color;
  ctx.strokeStyle = color;

  if (samplesPerColumn < 1) {
    // Individual samples are resolved: draw the line through them and mark each one.
    const first = Math.max(0, Math.floor(startSample) - 1);
    const last = Math.min(samples.length - 1, Math.ceil(view.end * sampleRate) + 1);
    const xAt = (i: number) => timeToX(i / sampleRate, view, area);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = first; i <= last; i++) {
      const y = mid - samples[i] * scale;
      if (i === first) ctx.moveTo(xAt(i), y);
      else ctx.lineTo(xAt(i), y);
    }
    ctx.stroke();
    if (samplesPerColumn < 0.12) {
      for (let i = first; i <= last; i++) {
        ctx.fillRect(xAt(i) - 2, mid - samples[i] * scale - 2, 4, 4);
      }
    }
    return;
  }

  const level = pyramid ? selectLevel(pyramid, samplesPerColumn) : null;
  const left = area.left;
  const step = 1 / dpr;
  for (let c = 0; c < columns; c++) {
    const from = startSample + c * samplesPerColumn;
    const to = from + samplesPerColumn;
    let lo = Infinity;
    let hi = -Infinity;
    if (level) {
      const b0 = Math.floor(from / level.blockSize);
      const b1 = Math.min(level.min.length, Math.ceil(to / level.blockSize));
      for (let b = b0; b < b1; b++) {
        if (level.min[b] < lo) lo = level.min[b];
        if (level.max[b] > hi) hi = level.max[b];
      }
    } else {
      const i1 = Math.min(samples.length, Math.ceil(to));
      for (let i = Math.floor(from); i < i1; i++) {
        if (samples[i] < lo) lo = samples[i];
        if (samples[i] > hi) hi = samples[i];
      }
    }
    if (lo === Infinity) continue;
    const y0 = mid - hi * scale;
    const y1 = mid - lo * scale;
    ctx.fillRect(left + c * step, y0, step, Math.max(step, y1 - y0));
  }
}

/** Bars along the plot edges: silence at the bottom, clipping at the top. */
function drawMarkers(ctx: CanvasRenderingContext2D, area: PlotArea, view: TimeRange): void {
  const { silence, scan } = audioStore.get();
  ctx.save();
  ctx.beginPath();
  ctx.rect(area.left, area.top, area.width, area.height);
  ctx.clip();
  const bar = (start: number, end: number, y: number, color: string) => {
    const x0 = timeToX(start, view, area);
    const x1 = timeToX(end, view, area);
    ctx.fillStyle = color;
    ctx.fillRect(x0, y, Math.max(2, x1 - x0), 4);
  };
  for (const region of silence?.regions ?? []) {
    bar(region.start, region.end, area.top + area.height - 4, CHART.silence);
  }
  for (const interval of scan?.clipping.intervals ?? []) {
    bar(interval.start, interval.end, area.top, CHART.clipping);
  }
  ctx.restore();
}

/** A tick along the top edge for each detected onset. */
function drawOnsets(ctx: CanvasRenderingContext2D, area: PlotArea, view: TimeRange): void {
  ctx.fillStyle = CHART.onset;
  for (const { time } of insightsStore.get().onsets) {
    if (time < view.start || time > view.end) continue;
    ctx.fillRect(Math.round(timeToX(time, view, area)), area.top, 1, area.height);
  }
}

export function WaveformViewer({
  markers = false,
  onsets = false,
}: {
  markers?: boolean;
  onsets?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const base = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const tooltip = useRef<HTMLDivElement>(null);
  const hover = useRef<HoverPoint | null>(null);
  const isPlaying = useStore(playbackStore, (s) => s.isPlaying);

  useCanvasRenderer(
    base,
    (ctx, width, height, dpr) => {
      const buffer = getAudioBuffer();
      ctx.fillStyle = CHART.background;
      ctx.fillRect(0, 0, width, height);
      if (!buffer) return;
      const { view } = selectionStore.get();
      const { waveform, recording } = audioStore.get();
      const area = timePlotArea(width, height);
      const channels = buffer.numberOfChannels;
      const laneHeight = area.height / channels;
      ctx.save();
      ctx.beginPath();
      ctx.rect(area.left, area.top, area.width, area.height);
      ctx.clip();
      for (let c = 0; c < channels; c++) {
        const top = area.top + c * laneHeight;
        ctx.fillStyle = CHART.zero;
        ctx.fillRect(area.left, Math.round(top + laneHeight / 2), area.width, 1);
        drawLane(
          ctx,
          buffer.getChannelData(c),
          waveform?.[c],
          buffer.sampleRate,
          view,
          area,
          top,
          laneHeight,
          CHART.channels[c % CHART.channels.length],
          dpr,
        );
      }
      ctx.restore();
      ctx.font = CHART_FONT;
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillStyle = CHART.label;
      for (let c = 0; c < channels; c++) {
        const top = area.top + c * laneHeight;
        ctx.fillText("+1", area.left - 6, top + 7);
        ctx.fillText("0", area.left - 6, top + laneHeight / 2);
        ctx.fillText("−1", area.left - 6, top + laneHeight - 7);
        ctx.textAlign = "left";
        ctx.fillText(recording?.decoded.channelLabels[c] ?? "", 4, top + laneHeight / 2);
        ctx.textAlign = "right";
      }
      drawTimeAxis(ctx, area, view);
    },
    {
      stores: BASE_STORES,
      dependencies: () => [
        selectionStore.get().view,
        audioStore.get().waveform,
        audioStore.get().recording,
      ],
    },
  );

  useCanvasRenderer(
    overlay,
    (ctx, width, height) => {
      ctx.clearRect(0, 0, width, height);
      const { view, time } = selectionStore.get();
      if (view.end <= view.start) return;
      const area = timePlotArea(width, height);
      if (markers) drawMarkers(ctx, area, view);
      if (onsets) drawOnsets(ctx, area, view);
      drawTimeOverlay(ctx, area, view, time, playback.position());
    },
    { stores: OVERLAY_STORES, animate: isPlaying },
  );

  useTimelineInteraction(container, {
    onHover: (point) => {
      hover.current = point;
      const element = tooltip.current;
      const buffer = getAudioBuffer();
      if (!element) return;
      if (!point || !buffer) {
        element.hidden = true;
        return;
      }
      const height = container.current?.clientHeight ?? 1;
      const area = timePlotArea(container.current?.clientWidth ?? 1, height);
      const lane = Math.min(
        buffer.numberOfChannels - 1,
        Math.max(0, Math.floor(((point.y - area.top) / area.height) * buffer.numberOfChannels)),
      );
      const index = Math.min(buffer.length - 1, Math.round(point.time * buffer.sampleRate));
      const value = buffer.getChannelData(lane)[index];
      element.hidden = false;
      element.textContent = `${formatTimePrecise(point.time)}  ·  ${formatAmplitude(value)}`;
      element.style.transform = `translate(${Math.min(point.x + 12, (container.current?.clientWidth ?? 0) - 150)}px, 8px)`;
    },
  });

  return (
    <div
      ref={container}
      className="relative h-full cursor-crosshair touch-none select-none overflow-hidden"
      role="img"
      aria-label="Waveform. Drag to select a time range, click to seek, scroll to zoom."
      data-testid="waveform"
    >
      <canvas ref={base} className="absolute inset-0 h-full w-full" />
      <canvas ref={overlay} className="absolute inset-0 h-full w-full" />
      <div
        ref={tooltip}
        hidden
        className="pointer-events-none absolute left-0 top-0 rounded border border-line bg-deep/95 px-1.5 py-0.5 text-[11px] tabular-nums"
      />
    </div>
  );
}
