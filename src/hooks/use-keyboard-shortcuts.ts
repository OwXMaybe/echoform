"use client";

import { useEffect } from "react";
import {
  playback,
  seekTo,
  stopPlayback,
  toggleLoop,
  toggleMute,
  togglePlay,
} from "@/stores/playback-store";
import {
  clearSelection,
  resetView,
  selectionStore,
  setTimeSelection,
  zoomView,
} from "@/stores/selection-store";

export function useKeyboardShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const { target } = event;
      if (target instanceof Element && target.closest("input, select, textarea")) return;
      if (event.ctrlKey || event.metaKey) return;
      // Space on a focused control must operate that control, not the transport.
      if (event.key === " " && target instanceof Element && target.closest("button, a, summary")) {
        return;
      }
      const actions: Record<string, () => void> = {
        " ": () => void togglePlay(),
        Home: () => seekTo(0),
        s: stopPlayback,
        m: toggleMute,
        l: () => {
          if (selectionStore.get().time) toggleLoop();
        },
        Escape: clearSelection,
        "[": () => {
          const { time, duration } = selectionStore.get();
          setTimeSelection(playback.position(), time?.end ?? duration);
        },
        "]": () => {
          setTimeSelection(selectionStore.get().time?.start ?? 0, playback.position());
        },
        ArrowLeft: () => seekTo(playback.position() - 1),
        ArrowRight: () => seekTo(playback.position() + 1),
        "+": () => zoomView(0.5),
        "=": () => zoomView(0.5),
        "-": () => zoomView(2),
        "0": resetView,
      };
      const action = actions[event.key];
      if (action) {
        event.preventDefault();
        action();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
