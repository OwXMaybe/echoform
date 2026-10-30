"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import type { Store } from "@/stores/create-store";

export type DrawFunction = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  dpr: number,
) => void;

interface RendererOptions {
  /** Repaint when any of these change. Must be a stable array. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  stores?: ReadonlyArray<Store<any>>;
  /** Repaint every animation frame while true. */
  animate?: boolean;
  /** What the drawing depends on. When set, a repaint is skipped if nothing here has changed. */
  dependencies?: () => readonly unknown[];
}

const NO_STORES: RendererOptions["stores"] = [];

/** Keeps a canvas at device resolution and repaints it at most once per animation frame. */
export function useCanvasRenderer(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  draw: DrawFunction,
  { stores = NO_STORES, animate = false, dependencies }: RendererOptions = {},
): void {
  const drawRef = useRef(draw);
  const frame = useRef(0);
  const dependenciesRef = useRef(dependencies);
  const painted = useRef<readonly unknown[] | null>(null);

  useLayoutEffect(() => {
    drawRef.current = draw;
    dependenciesRef.current = dependencies;
  });

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width === 0 || height === 0) return;
    const dpr = window.devicePixelRatio || 1;
    const pixelWidth = Math.round(width * dpr);
    const pixelHeight = Math.round(height * dpr);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
      painted.current = null;
    }
    const current = dependenciesRef.current?.() ?? null;
    const previous = painted.current;
    if (current && previous && current.every((value, i) => value === previous[i])) return;
    painted.current = current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawRef.current(ctx, width, height, dpr);
  }, [canvasRef]);

  const schedule = useCallback(() => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      paint();
    });
  }, [paint]);

  useEffect(schedule);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(schedule);
    observer.observe(canvas);
    const unsubscribers = (stores ?? []).map((store) => store.subscribe(schedule));
    return () => {
      observer.disconnect();
      unsubscribers.forEach((unsubscribe) => unsubscribe());
      cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
  }, [canvasRef, schedule, stores]);

  useEffect(() => {
    if (!animate) return;
    let id = 0;
    const loop = () => {
      paint();
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [animate, paint]);
}
