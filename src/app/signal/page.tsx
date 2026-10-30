"use client";

import { RecordingFrame } from "@/components/layout/RecordingFrame";
import { LevelTimeline } from "@/components/signal/LevelTimeline";
import {
  ClippingPanel,
  DcOffsetPanel,
  DistributionPanel,
  SilencePanel,
} from "@/components/signal/SignalPanels";

export default function SignalPage() {
  return (
    <RecordingFrame title="Signal Analysis" markers>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="border-b border-line">
          <LevelTimeline />
        </div>
        <DistributionPanel />
        <SilencePanel />
        <ClippingPanel />
        <DcOffsetPanel />
      </div>
    </RecordingFrame>
  );
}
