"use client";

import { useEffect } from "react";
import { useStore } from "@/stores/create-store";
import { playback, playbackStore } from "@/stores/playback-store";
import { selectionStore, setView } from "@/stores/selection-store";

/** While playing zoomed in, turns the view like a page whenever the playhead leaves it. */
export function useFollowPlayhead(): void {
  const isPlaying = useStore(playbackStore, (s) => s.isPlaying);
  useEffect(() => {
    if (!isPlaying) return;
    let id = 0;
    const tick = () => {
      const { view, duration } = selectionStore.get();
      const span = view.end - view.start;
      const position = playback.position();
      if (span < duration && (position >= view.end || position < view.start)) {
        const start = position - span * 0.05;
        setView(start, start + span);
      }
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [isPlaying]);
}
