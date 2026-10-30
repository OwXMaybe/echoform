"use client";

import { RecordingFrame } from "@/components/layout/RecordingFrame";
import { StereoPanels } from "@/components/stereo/StereoPanels";

export default function StereoPage() {
  return (
    <RecordingFrame title="Stereo Analysis">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <StereoPanels />
      </div>
    </RecordingFrame>
  );
}
