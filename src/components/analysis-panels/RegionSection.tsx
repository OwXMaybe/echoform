"use client";

import { useEffect, useState } from "react";
import { Explained } from "@/components/shared/controls";
import { measureRegion } from "@/core/analysis/region";
import { audioStore, visibleSpectrogram } from "@/stores/audio-store";
import { useStore } from "@/stores/create-store";
import { selectionStore } from "@/stores/selection-store";
import type { RegionMeasurement } from "@/types/analysis";
import { formatDb, formatHz, formatTimePrecise } from "@/utils/formatting";

const MEASURE_DELAY_MS = 120;

/** Readings for a time-frequency box, shown once both ranges are selected. */
export function RegionSection() {
  const time = useStore(selectionStore, (s) => s.time);
  const frequency = useStore(selectionStore, (s) => s.frequency);
  const overview = useStore(audioStore, (s) => s.spectrogram);
  const detail = useStore(audioStore, (s) => s.spectrogramDetail);
  const [result, setResult] = useState<RegionMeasurement | null>(null);

  useEffect(() => {
    if (!time || !frequency || !overview) return;
    // A large box touches millions of cells, so wait for the drag to settle.
    const timer = setTimeout(() => {
      const g = visibleSpectrogram(time);
      if (!g) return;
      setResult(
        measureRegion(g, {
          startSeconds: time.start,
          endSeconds: time.end,
          minHz: frequency.min,
          maxHz: frequency.max,
        }),
      );
    }, MEASURE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [time, frequency, overview, detail]);

  if (!time || !frequency) return null;
  return (
    <section className="border-b border-line px-3 py-3">
      <h2 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-faint">
        Selected region
      </h2>
      {!result ? (
        <p className="text-xs text-muted">Measuring…</p>
      ) : (
        <div className="space-y-0.5 text-xs" data-testid="region">
          <Explained metric="region">
            <span className="text-muted">Band level</span>
            <span className="ml-auto tabular-nums">{formatDb(result.bandLevelDb)}</span>
          </Explained>
          <div className="flex justify-between">
            <span className="text-muted">Strongest cell</span>
            <span className="tabular-nums">{formatDb(result.peakDb, "dB")}</span>
          </div>
          {result.peakDb !== null && (
            <div className="flex justify-between">
              <span className="text-muted">At</span>
              <span className="tabular-nums">
                {formatHz(result.peakHz)}, {formatTimePrecise(result.peakSeconds)}
              </span>
            </div>
          )}
          <p className="pt-1 text-[11px] text-faint">
            {result.columns} × {result.bins} spectrogram cells
          </p>
        </div>
      )}
    </section>
  );
}
