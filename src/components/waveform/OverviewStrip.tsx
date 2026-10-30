"use client";

import { useRef } from "react";
import { CHART } from "@/core/visualization/plot";
import { useCanvasRenderer } from "@/hooks/use-canvas-renderer";
import { audioStore } from "@/stores/audio-store";
import { useStore } from "@/stores/create-store";
import { playback, playbackStore } from "@/stores/playback-store";
import { selectionStore, setView } from "@/stores/selection-store";

const OVERLAY_STORES = [selectionStore, playbackStore, audioStore];

/** Whole-recording navigator. Drag to move the visible window. */
export function OverviewStrip() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const isPlaying = useStore(playbackStore, (s) => s.isPlaying);

  useCanvasRenderer(
    canvas,
    (ctx, width, height, dpr) => {
      ctx.fillStyle = CHART.background;
      ctx.fillRect(0, 0, width, height);
      const { waveform } = audioStore.get();
      const { duration, view, time } = selectionStore.get();
      if (duration <= 0) return;
      const left = 52;
      const plotWidth = width - 66;
      if (waveform) {
        const coarsest = waveform.map((pyramid) => pyramid[pyramid.length - 1]);
        const columns = Math.round(plotWidth * dpr);
        const mid = height / 2;
        ctx.fillStyle = CHART.zero;
        for (let c = 0; c < columns; c++) {
          let lo = 0;
          let hi = 0;
          for (const level of coarsest) {
            const b0 = Math.floor((c / columns) * level.min.length);
            const b1 = Math.max(b0 + 1, Math.floor(((c + 1) / columns) * level.min.length));
            for (let b = b0; b < b1 && b < level.min.length; b++) {
              lo = Math.min(lo, level.min[b]);
              hi = Math.max(hi, level.max[b]);
            }
          }
          ctx.fillRect(left + c / dpr, mid - hi * (mid - 1), 1 / dpr, Math.max(1 / dpr, (hi - lo) * (mid - 1)));
        }
      }
      const toX = (t: number) => left + (t / duration) * plotWidth;
      if (time) {
        ctx.fillStyle = CHART.selectionEdge;
        ctx.fillRect(toX(time.start), height - 3, Math.max(1, toX(time.end) - toX(time.start)), 3);
      }
      ctx.fillStyle = "rgba(34, 211, 238, 0.12)";
      ctx.fillRect(toX(view.start), 0, Math.max(2, toX(view.end) - toX(view.start)), height);
      ctx.strokeStyle = CHART.selectionEdge;
      ctx.lineWidth = 1;
      ctx.strokeRect(toX(view.start) + 0.5, 0.5, Math.max(2, toX(view.end) - toX(view.start)) - 1, height - 1);
      ctx.fillStyle = CHART.playhead;
      ctx.fillRect(toX(playback.position()), 0, 1, height);
    },
    { stores: OVERLAY_STORES, animate: isPlaying },
  );

  const moveTo = (clientX: number, element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    const { duration, view } = selectionStore.get();
    const span = view.end - view.start;
    const center = ((clientX - rect.left - 52) / (rect.width - 66)) * duration;
    setView(center - span / 2, center + span / 2);
  };

  return (
    <canvas
      ref={canvas}
      aria-hidden
      className="block h-full w-full cursor-grab touch-none"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        moveTo(event.clientX, event.currentTarget);
      }}
      onPointerMove={(event) => {
        if (event.buttons === 1) moveTo(event.clientX, event.currentTarget);
      }}
    />
  );
}
