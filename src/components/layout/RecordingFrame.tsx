"use client";

import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Inspector } from "@/components/analysis-panels/Inspector";
import { TransportBar } from "@/components/audio-player/TransportBar";
import { DropZone } from "@/components/shared/DropZone";
import { IconButton } from "@/components/shared/controls";
import { OverviewStrip } from "@/components/waveform/OverviewStrip";
import { WaveformViewer } from "@/components/waveform/WaveformViewer";
import { useFollowPlayhead } from "@/hooks/use-follow-playhead";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";
import { audioStore } from "@/stores/audio-store";
import { useStore } from "@/stores/create-store";

/** The player, waveform and inspector shared by every view of a recording. */
export function RecordingFrame({
  title,
  controls,
  markers,
  onsets,
  children,
}: {
  title: string;
  /** Shown between the transport and the waveform. */
  controls?: ReactNode;
  markers?: boolean;
  /** Marks detected onsets on the waveform. */
  onsets?: boolean;
  children: ReactNode;
}) {
  const hasRecording = useStore(audioStore, (s) => s.recording !== null);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  useKeyboardShortcuts();
  useFollowPlayhead();

  if (!hasRecording) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <h1 className="mb-1 text-lg font-semibold">{title}</h1>
        <p className="mb-4 text-sm text-muted">Open a recording to start analysing it.</p>
        <DropZone />
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col lg:h-full lg:flex-row">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <h1 className="sr-only">{title}</h1>
        <TransportBar />
        {controls}
        <div className="h-44 shrink-0 border-b border-line">
          <WaveformViewer markers={markers} onsets={onsets} />
        </div>
        <div className="h-7 shrink-0 border-b border-line">
          <OverviewStrip />
        </div>
        {children}
      </div>
      {inspectorOpen ? (
        <aside className="relative border-t border-line bg-surface lg:h-full lg:w-72 lg:shrink-0 lg:border-l lg:border-t-0">
          <div className="absolute right-1 top-1 z-10 hidden lg:block">
            <IconButton label="Collapse inspector" onClick={() => setInspectorOpen(false)}>
              <PanelRightClose className="size-4" aria-hidden />
            </IconButton>
          </div>
          <Inspector />
        </aside>
      ) : (
        <div className="hidden border-l border-line bg-surface p-1 lg:block">
          <IconButton label="Expand inspector" onClick={() => setInspectorOpen(true)}>
            <PanelRightOpen className="size-4" aria-hidden />
          </IconButton>
        </div>
      )}
    </div>
  );
}
