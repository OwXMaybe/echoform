"use client";

import { AnalysisControls } from "@/components/analysis-panels/AnalysisControls";
import { InsightPanels } from "@/components/insights/InsightPanels";
import { RecordingFrame } from "@/components/layout/RecordingFrame";

export default function InsightsPage() {
  return (
    <RecordingFrame title="Events and Pitch" controls={<AnalysisControls />} onsets>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <InsightPanels />
      </div>
    </RecordingFrame>
  );
}
