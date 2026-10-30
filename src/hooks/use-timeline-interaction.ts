"use client";

import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { timePlotArea, xToTime } from "@/core/visualization/plot";
import { seekTo } from "@/stores/playback-store";
import {
  panView,
  selectionStore,
  setFrequencySelection,
  setTimeSelection,
  zoomView,
} from "@/stores/selection-store";

const DRAG_THRESHOLD_PX = 4;

export interface HoverPoint {
  x: number;
  y: number;
  time: number;
}

interface Options {
  /** Maps a y position to a frequency; enables region selection. */
  yToFrequency?: (y: number, height: number) => number;
  /** When true, dragging also selects a frequency range. */
  regionTool?: boolean;
  onHover: (point: HoverPoint | null) => void;
}

/** Click to seek, drag to select, wheel to zoom, shift-wheel to pan. Shared by time-based views. */
export function useTimelineInteraction(
  elementRef: RefObject<HTMLElement | null>,
  options: Options,
): void {
  const latest = useRef(options);
  useLayoutEffect(() => {
    latest.current = options;
  });

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;

    const locate = (event: MouseEvent) => {
      const rect = element.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const area = timePlotArea(rect.width, rect.height);
      const { view } = selectionStore.get();
      const clampedX = Math.max(area.left, Math.min(area.left + area.width, x));
      return { x, y, area, height: rect.height, time: xToTime(clampedX, view, area) };
    };

    let drag: { x: number; time: number; y: number; moved: boolean; height: number } | null = null;

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const { x, y, time, height } = locate(event);
      drag = { x, y, time, moved: false, height };
      element.setPointerCapture(event.pointerId);
    };

    const onPointerMove = (event: PointerEvent) => {
      const { x, y, time, area } = locate(event);
      const inside = x >= area.left && x <= area.left + area.width && y <= area.top + area.height;
      latest.current.onHover(inside || drag ? { x, y, time } : null);
      if (!drag) return;
      if (!drag.moved && Math.abs(x - drag.x) < DRAG_THRESHOLD_PX) return;
      drag.moved = true;
      setTimeSelection(drag.time, time);
      const { regionTool, yToFrequency } = latest.current;
      if (regionTool && yToFrequency) {
        setFrequencySelection(yToFrequency(drag.y, drag.height), yToFrequency(y, drag.height));
      }
    };

    const onPointerUp = (event: PointerEvent) => {
      if (drag && !drag.moved) seekTo(locate(event).time);
      drag = null;
      const rect = element.getBoundingClientRect();
      const outside =
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom;
      if (outside) latest.current.onHover(null);
    };

    const onLeave = () => {
      if (!drag) latest.current.onHover(null);
    };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        const { view } = selectionStore.get();
        const delta = event.deltaX || event.deltaY;
        panView((delta / element.clientWidth) * (view.end - view.start));
      } else {
        zoomView(Math.exp(event.deltaY * 0.0015), locate(event).time);
      }
    };

    element.addEventListener("pointerdown", onPointerDown);
    element.addEventListener("pointermove", onPointerMove);
    element.addEventListener("pointerup", onPointerUp);
    element.addEventListener("pointerleave", onLeave);
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      element.removeEventListener("pointerdown", onPointerDown);
      element.removeEventListener("pointermove", onPointerMove);
      element.removeEventListener("pointerup", onPointerUp);
      element.removeEventListener("pointerleave", onLeave);
      element.removeEventListener("wheel", onWheel);
    };
  }, [elementRef]);
}
