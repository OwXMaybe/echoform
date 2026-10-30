"use client";

import {
  Maximize2,
  Pause,
  Play,
  Repeat,
  Square,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { IconButton, LabeledSelect } from "@/components/shared/controls";
import { audioStore } from "@/stores/audio-store";
import { useStore } from "@/stores/create-store";
import { filterStore } from "@/stores/filter-store";
import {
  playback,
  playbackStore,
  setRate,
  setVolume,
  stopPlayback,
  toggleLoop,
  toggleMute,
  togglePlay,
} from "@/stores/playback-store";
import {
  resetView,
  selectionStore,
  zoomToSelection,
  zoomView,
} from "@/stores/selection-store";
import { formatTimePrecise } from "@/utils/formatting";

const RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2].map((value) => ({
  value,
  label: `${value}×`,
}));

/** Updates its text directly: the time changes every frame and must not re-render React. */
function PlayheadReadout() {
  const text = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let id = 0;
    let last = "";
    const tick = () => {
      const next = formatTimePrecise(playback.position());
      if (next !== last && text.current) text.current.textContent = next;
      last = next;
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, []);
  return <span ref={text} data-testid="playhead" />;
}

export function TransportBar() {
  const isPlaying = useStore(playbackStore, (s) => s.isPlaying);
  const volume = useStore(playbackStore, (s) => s.volume);
  const muted = useStore(playbackStore, (s) => s.muted);
  const rate = useStore(playbackStore, (s) => s.rate);
  const loop = useStore(playbackStore, (s) => s.loop);
  const duration = useStore(audioStore, (s) => s.recording?.decoded.duration ?? 0);
  const hasSelection = useStore(selectionStore, (s) => s.time !== null);
  const monitor = useStore(filterStore, (s) => s.monitor);

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-surface px-3 py-1.5">
      <div className="flex items-center">
        <button
          type="button"
          aria-label={isPlaying ? "Pause" : "Play"}
          title={isPlaying ? "Pause (Space)" : "Play (Space)"}
          onClick={() => void togglePlay()}
          className="mr-1 rounded-md bg-accent p-1.5 text-deep hover:bg-accent/90"
        >
          {isPlaying ? (
            <Pause className="size-4" aria-hidden />
          ) : (
            <Play className="size-4" aria-hidden />
          )}
        </button>
        <IconButton label="Stop" onClick={stopPlayback}>
          <Square className="size-4" aria-hidden />
        </IconButton>
        <IconButton
          label={hasSelection ? "Loop selection (L)" : "Select a time range to loop it"}
          active={loop}
          disabled={!hasSelection}
          onClick={toggleLoop}
        >
          <Repeat className="size-4" aria-hidden />
        </IconButton>
      </div>

      <p className="text-sm tabular-nums">
        <PlayheadReadout />
        <span className="text-faint"> / {formatTimePrecise(duration)}</span>
      </p>

      <div className="flex items-center gap-1">
        <IconButton label={muted ? "Unmute (M)" : "Mute (M)"} onClick={toggleMute}>
          {muted ? (
            <VolumeX className="size-4" aria-hidden />
          ) : (
            <Volume2 className="size-4" aria-hidden />
          )}
        </IconButton>
        <input
          type="range"
          aria-label="Volume"
          min={0}
          max={1}
          step={0.01}
          value={muted ? 0 : volume}
          onChange={(event) => setVolume(Number(event.target.value))}
          className="w-20"
        />
      </div>

      <LabeledSelect label="Speed" value={rate} options={RATES} onChange={setRate} />

      {monitor === "processed" && (
        <Link
          href="/filters"
          className="rounded border border-accent/50 px-1.5 py-0.5 text-xs text-accent hover:bg-raised"
          data-testid="processed-indicator"
        >
          Hearing processed audio
        </Link>
      )}

      <div className="ml-auto flex items-center">
        <IconButton label="Zoom in (+)" onClick={() => zoomView(0.5)}>
          <ZoomIn className="size-4" aria-hidden />
        </IconButton>
        <IconButton label="Zoom out (−)" onClick={() => zoomView(2)}>
          <ZoomOut className="size-4" aria-hidden />
        </IconButton>
        <button
          type="button"
          disabled={!hasSelection}
          onClick={zoomToSelection}
          className="rounded-md px-2 py-1 text-xs text-muted hover:bg-raised hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent"
        >
          Zoom to selection
        </button>
        <IconButton label="Show whole recording (0)" onClick={resetView}>
          <Maximize2 className="size-4" aria-hidden />
        </IconButton>
      </div>
    </div>
  );
}
