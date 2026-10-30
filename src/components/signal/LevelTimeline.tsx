"use client";

import { useRef } from "react";
import {
  CHART,
  CHART_FONT,
  drawTimeAxis,
  drawTimeOverlay,
  timePlotArea,
} from "@/core/visualization/plot";
import { linearTicks } from "@/core/visualization/scales";
import { useCanvasRenderer } from "@/hooks/use-canvas-renderer";
import { useTimelineInteraction } from "@/hooks/use-timeline-interaction";
import { audioStore } from "@/stores/audio-store";
import { useStore } from "@/stores/create-store";
import { playback, playbackStore } from "@/stores/playback-store";
import { selectionStore } from "@/stores/selection-store";
import { formatDb, formatTimePrecise } from "@/utils/formatting";

const FLOOR_DB = -72;
const BASE_STORES = [audioStore, selectionStore];
const OVERLAY_STORES = [selectionStore, playbackStore];

/** Short-term RMS across the recording. Shares its time axis with the waveform above it. */
export function LevelTimeline() {
  const container = useRef<HTMLDivElement>(null);
  const base = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const tooltip = useRef<HTMLDivElement>(null);
  const isPlaying = useStore(playbackStore, (s) => s.isPlaying);
  const labels = useStore(audioStore, (s) => s.recording?.decoded.channelLabels ?? null);

  useCanvasRenderer(
    base,
    (ctx, width, height) => {
      ctx.fillStyle = CHART.background;
      ctx.fillRect(0, 0, width, height);
      const { scan } = audioStore.get();
      const { view } = selectionStore.get();
      if (!scan || view.end <= view.start) return;
      const area = timePlotArea(width, height);
      const toY = (db: number) => area.top + (db / FLOOR_DB) * area.height;

      ctx.font = CHART_FONT;
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      for (const db of linearTicks(FLOOR_DB, 0, 4)) {
        const y = Math.round(toY(db));
        ctx.fillStyle = CHART.grid;
        ctx.fillRect(area.left, y, area.width, 1);
        ctx.fillStyle = CHART.label;
        ctx.fillText(String(db).replace("-", "−"), area.left - 6, y);
      }

      ctx.save();
      ctx.beginPath();
      ctx.rect(area.left, area.top, area.width, area.height);
      ctx.clip();
      ctx.lineWidth = 2;
      ctx.lineJoin = "round";
      const span = view.end - view.start;
      scan.levels.forEach((levels, channel) => {
        ctx.strokeStyle = CHART.channels[channel % CHART.channels.length];
        ctx.beginPath();
        for (let px = 0; px <= area.width; px++) {
          const t0 = view.start + (px / area.width) * span;
          const t1 = view.start + ((px + 1) / area.width) * span;
          const b0 = Math.min(levels.length - 1, Math.floor(t0 / scan.blockSeconds));
          const b1 = Math.min(levels.length - 1, Math.max(b0, Math.floor(t1 / scan.blockSeconds) - 1));
          let best = -Infinity;
          for (let b = b0; b <= b1; b++) if (levels[b] > best) best = levels[b];
          const y = toY(Math.max(FLOOR_DB, best));
          if (px === 0) ctx.moveTo(area.left, y);
          else ctx.lineTo(area.left + px, y);
        }
        ctx.stroke();
      });
      ctx.restore();
      drawTimeAxis(ctx, area, view);
    },
    { stores: BASE_STORES },
  );

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
      const { scan, recording } = audioStore.get();
      if (!element) return;
      if (!point || !scan || !recording) {
        element.hidden = true;
        return;
      }
      const block = Math.floor(point.time / scan.blockSeconds);
      const parts = scan.levels.map((levels, channel) => {
        const db = levels[Math.min(levels.length - 1, block)];
        const label = recording.decoded.channelLabels[channel];
        return `${label} ${db <= -200 ? "no signal" : formatDb(db, "dB")}`;
      });
      element.hidden = false;
      element.textContent = [formatTimePrecise(point.time), ...parts].join("  ·  ");
      const width = container.current?.clientWidth ?? 0;
      const left = point.x > width - 300 ? point.x - 290 : point.x + 12;
      element.style.transform = `translate(${left}px, 8px)`;
    },
  });

  return (
    <figure className="m-0">
      <figcaption className="flex items-center gap-3 px-3 pt-2 text-xs text-muted">
        <span>Short-term RMS level (dBFS, 100 ms blocks)</span>
        {labels && labels.length > 1 && (
          <span className="flex gap-3">
            {labels.map((label, index) => (
              <span key={label} className="flex items-center gap-1">
                <span
                  className="size-2 rounded-full"
                  style={{ background: CHART.channels[index % CHART.channels.length] }}
                />
                {label}
              </span>
            ))}
          </span>
        )}
      </figcaption>
      <div
        ref={container}
        role="img"
        aria-label="Short-term level over time. Drag to select a time range."
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
    </figure>
  );
}
