"use client";

import { useState } from "react";
import { AnalysisControls } from "@/components/analysis-panels/AnalysisControls";
import { RecordingFrame } from "@/components/layout/RecordingFrame";
import { Explained, Segmented } from "@/components/shared/controls";
import { SpectrogramViewer } from "@/components/spectrogram/SpectrogramViewer";
import { SpectrumAnalyzer } from "@/components/spectrum/SpectrumAnalyzer";
import { SpectrumControls } from "@/components/spectrum/SpectrumControls";
import { COLOR_MAPS } from "@/core/visualization/color-maps";
import { audioStore, visibleSpectrogram } from "@/stores/audio-store";
import { useStore } from "@/stores/create-store";
import { selectionStore } from "@/stores/selection-store";
import { settingsStore } from "@/stores/settings-store";

type Tab = "spectrogram" | "spectrum";

const TABS = [
  { value: "spectrogram", label: "Spectrogram" },
  { value: "spectrum", label: "Spectrum" },
] as const;

const TOOLS = [
  { value: "time", label: "Select time" },
  { value: "region", label: "Select region" },
] as const;

function ColorScale() {
  const name = useStore(settingsStore, (s) => s.colorMap);
  const range = useStore(settingsStore, (s) => s.dynamicRangeDb);
  const max = useStore(audioStore, (s) => s.spectrogram?.maxDb ?? null);
  const stops = COLOR_MAPS[name]
    .split(",")
    .map((hex) => `#${hex}`)
    .join(",");
  if (max === null) return null;
  const format = (db: number) => db.toFixed(0).replace("-", "−");
  return (
    <div className="flex items-center gap-1.5 text-[11px] tabular-nums text-muted">
      {format(max - range)}
      <span
        className="h-2.5 w-20 rounded-sm"
        style={{ background: `linear-gradient(to right, ${stops})` }}
      />
      {format(max)} dB
    </div>
  );
}

function SpectrogramNotes() {
  const overview = useStore(audioStore, (s) => s.spectrogram);
  useStore(audioStore, (s) => s.spectrogramDetail);
  const view = useStore(selectionStore, (s) => s.view);
  const refining = useStore(audioStore, (s) => s.status.spectrogramDetail === "running");
  const g = visibleSpectrogram(view);
  if (!g) return null;
  const capped = g.framesPerColumn > 1;
  return (
    <span className="text-[11px] tabular-nums text-faint" data-testid="spectrogram-notes">
      {g !== overview && "Zoom detail · "}
      {g.columns} × {g.bins}
      {capped && ` · ${g.framesPerColumn} frames per column (memory cap)`}
      {refining && " · refining…"}
    </span>
  );
}

function BandZoom() {
  const frequency = useStore(selectionStore, (s) => s.frequency);
  const zoomed = useStore(settingsStore, (s) => s.viewMinHz !== null || s.viewMaxHz !== null);
  const style = "rounded px-2 py-1 text-xs text-muted hover:bg-raised hover:text-ink";
  return (
    <>
      {frequency && (
        <button
          type="button"
          className={style}
          onClick={() => settingsStore.set({ viewMinHz: frequency.min, viewMaxHz: frequency.max })}
        >
          Zoom to band
        </button>
      )}
      {zoomed && (
        <button
          type="button"
          className={style}
          onClick={() => settingsStore.set({ viewMinHz: null, viewMaxHz: null })}
        >
          All frequencies
        </button>
      )}
    </>
  );
}

function AnalysisPanel() {
  const [tab, setTab] = useState<Tab>("spectrogram");
  const regionTool = useStore(settingsStore, (s) => s.regionTool);
  return (
    <section className="flex min-h-72 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5">
        <Segmented label="Analysis view" value={tab} options={TABS} onChange={setTab} />
        {tab === "spectrogram" ? (
          <>
            <Segmented
              label="Selection tool"
              value={regionTool ? "region" : "time"}
              options={TOOLS}
              onChange={(value) => settingsStore.set({ regionTool: value === "region" })}
            />
            <BandZoom />
            <ColorScale />
            <SpectrogramNotes />
            <div className="ml-auto">
              <Explained metric="spectrogram">
                <span className="text-xs text-muted">About</span>
              </Explained>
            </div>
          </>
        ) : (
          <>
            <SpectrumControls />
            <div className="ml-auto">
              <Explained metric="spectrum">
                <span className="text-xs text-muted">About</span>
              </Explained>
            </div>
          </>
        )}
      </div>
      <div className="min-h-0 flex-1 border-t border-line">
        {tab === "spectrogram" ? <SpectrogramViewer /> : <SpectrumAnalyzer />}
      </div>
    </section>
  );
}

export default function WorkspacePage() {
  return (
    <RecordingFrame title="Audio Workspace" controls={<AnalysisControls />}>
      <AnalysisPanel />
    </RecordingFrame>
  );
}
