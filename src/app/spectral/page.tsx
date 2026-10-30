"use client";

import { AnalysisControls } from "@/components/analysis-panels/AnalysisControls";
import { RecordingFrame } from "@/components/layout/RecordingFrame";
import { Explained } from "@/components/shared/controls";
import { DescriptorPanel } from "@/components/spectrum/DescriptorPanel";
import { SpectrumAnalyzer } from "@/components/spectrum/SpectrumAnalyzer";
import { SpectrumControls } from "@/components/spectrum/SpectrumControls";

export default function SpectralPage() {
  return (
    <RecordingFrame title="Spectral Analysis" controls={<AnalysisControls />}>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5">
          <SpectrumControls />
          <span className="text-xs text-faint">Drag on the chart to select a frequency band.</span>
          <div className="ml-auto">
            <Explained metric="spectrum">
              <span className="text-xs text-muted">About</span>
            </Explained>
          </div>
        </div>
        <div className="h-80 border-y border-line">
          <SpectrumAnalyzer markers />
        </div>
        <DescriptorPanel />
      </div>
    </RecordingFrame>
  );
}
