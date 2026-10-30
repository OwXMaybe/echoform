"use client";

import { AnalysisControls } from "@/components/analysis-panels/AnalysisControls";
import { FilterChain } from "@/components/filters/FilterChain";
import { ProcessedSpectrumChart, ResponseChart } from "@/components/filters/FilterCharts";
import { RecordingFrame } from "@/components/layout/RecordingFrame";

export default function FiltersPage() {
  return (
    <RecordingFrame title="Filter Laboratory" controls={<AnalysisControls />}>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <FilterChain />
        <div className="border-b border-line">
          <ResponseChart />
        </div>
        <ProcessedSpectrumChart />
      </div>
    </RecordingFrame>
  );
}
