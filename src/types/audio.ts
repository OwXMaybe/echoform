import type { OriginalFileProperties } from "@/core/audio/file-format";

/** What the file itself says, independent of how the browser decoded it. */
export interface OriginalFileMetadata extends OriginalFileProperties {
  name: string;
  sizeBytes: number;
  mimeType: string;
}

/** The PCM the browser decoder produced; the analysis engine works on this. */
export interface DecodedAudioMetadata {
  sampleRate: number;
  channelCount: number;
  frameCount: number;
  duration: number;
  /** True when the decoded rate differs from, or could not be checked against, the file. */
  resampled: boolean;
  channelLabels: string[];
}

export interface AudioRecording {
  id: string;
  original: OriginalFileMetadata;
  decoded: DecodedAudioMetadata;
  warnings: string[];
}
