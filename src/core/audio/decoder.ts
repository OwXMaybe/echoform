import type { AudioRecording, OriginalFileMetadata } from "@/types/audio";
import { identifyAudioFile } from "./file-format";

export const MAX_FILE_BYTES = 1024 * 1024 * 1024;
const LONG_RECORDING_SECONDS = 2 * 60 * 60;
const FALLBACK_DECODE_RATE = 48000;

export class AudioImportError extends Error {}

export function channelLabels(count: number): string[] {
  if (count === 1) return ["Mono"];
  if (count === 2) return ["Left", "Right"];
  return Array.from({ length: count }, (_, i) => `Ch ${i + 1}`);
}

function validateSize(file: File): void {
  if (file.size === 0) {
    throw new AudioImportError(`"${file.name}" is empty.`);
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new AudioImportError(
      `"${file.name}" is larger than the 1 GB limit; decoded audio would not fit reliably in browser memory.`,
    );
  }
}

async function decode(bytes: ArrayBuffer, sampleRate: number): Promise<AudioBuffer> {
  // decodeAudioData resamples to its context's rate, so the context must match the file.
  const context = new OfflineAudioContext(1, 1, sampleRate);
  return context.decodeAudioData(bytes);
}

function extensionMismatch(file: File, format: string): string | null {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const expected: Record<string, string[]> = {
    wav: ["wav", "wave"],
    flac: ["flac"],
    mp3: ["mp3"],
    ogg: ["ogg", "oga", "opus"],
    m4a: ["m4a", "mp4", "aac"],
    aac: ["aac"],
  };
  if (!expected[format] || expected[format].includes(extension)) return null;
  return `The file extension ".${extension}" does not match its contents, which identify as ${format.toUpperCase()}.`;
}

/** Validates and decodes a file. Throws AudioImportError with a user-facing message. */
export async function importAudioFile(
  file: File,
  onStage: (stage: string) => void,
): Promise<{ recording: AudioRecording; buffer: AudioBuffer }> {
  validateSize(file);
  onStage("Reading file");
  let bytes: ArrayBuffer;
  try {
    bytes = await file.arrayBuffer();
  } catch {
    throw new AudioImportError(`"${file.name}" could not be read from disk.`);
  }

  const properties = identifyAudioFile(bytes);
  const original: OriginalFileMetadata = {
    ...properties,
    name: file.name,
    sizeBytes: file.size,
    mimeType: file.type,
  };

  onStage("Decoding audio");
  const decodeRate = properties.sampleRate ?? FALLBACK_DECODE_RATE;
  let buffer: AudioBuffer;
  try {
    buffer = await decode(bytes, decodeRate);
  } catch {
    throw new AudioImportError(
      properties.format === "unknown"
        ? `"${file.name}" does not appear to be an audio file this browser can decode.`
        : `This browser could not decode "${file.name}" (${properties.formatLabel}). The file may be corrupted or use an unsupported codec.`,
    );
  }
  if (buffer.length === 0 || buffer.numberOfChannels === 0) {
    throw new AudioImportError(`"${file.name}" contains no audio samples.`);
  }

  const warnings: string[] = [];
  const mismatch = extensionMismatch(file, properties.format);
  if (mismatch) warnings.push(mismatch);
  const resampled = properties.sampleRate !== buffer.sampleRate;
  if (resampled) {
    warnings.push(
      properties.sampleRate === null
        ? `The original sample rate could not be read from this ${properties.formatLabel} file, so the browser decoded it to ${buffer.sampleRate} Hz. Measurements describe the resampled audio.`
        : `The browser resampled this file from ${properties.sampleRate} Hz to ${buffer.sampleRate} Hz. Measurements describe the resampled audio.`,
    );
  }
  if (buffer.duration > LONG_RECORDING_SECONDS) {
    warnings.push("This is a very long recording; analysis and memory use will be high.");
  }

  return {
    buffer,
    recording: {
      id: crypto.randomUUID(),
      original,
      decoded: {
        sampleRate: buffer.sampleRate,
        channelCount: buffer.numberOfChannels,
        frameCount: buffer.length,
        duration: buffer.duration,
        resampled,
        channelLabels: channelLabels(buffer.numberOfChannels),
      },
      warnings,
    },
  };
}

const PROBES: ReadonlyArray<readonly [string, string]> = [
  ["WAV", "audio/wav"],
  ["MP3", "audio/mpeg"],
  ["FLAC", "audio/flac"],
  ["Ogg Vorbis", 'audio/ogg; codecs="vorbis"'],
  ["Ogg Opus", 'audio/ogg; codecs="opus"'],
  ["M4A / AAC", 'audio/mp4; codecs="mp4a.40.2"'],
];

export interface FormatSupport {
  label: string;
  supported: boolean;
}

let formatSupport: FormatSupport[] | null = null;

/** The running browser's own answer; cached so it is a stable external-store snapshot. */
export function probeFormatSupport(): FormatSupport[] {
  if (!formatSupport) {
    const probe = document.createElement("audio");
    formatSupport = PROBES.map(([label, type]) => ({
      label,
      supported: probe.canPlayType(type) !== "",
    }));
  }
  return formatSupport;
}
