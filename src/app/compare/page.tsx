"use client";

import { AnalysisControls } from "@/components/analysis-panels/AnalysisControls";
import { ComparisonLab } from "@/components/comparison/ComparisonLab";
import { RecordingFrame } from "@/components/layout/RecordingFrame";

export default function ComparePage() {
  return (
    <RecordingFrame title="Comparison Lab" controls={<AnalysisControls />}>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <ComparisonLab />
      </div>
    </RecordingFrame>
  );
}
