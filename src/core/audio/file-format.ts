export type ContainerFormat = "wav" | "flac" | "mp3" | "ogg" | "m4a" | "aac" | "unknown";

/** Properties read from the file's own header, never from the decoded audio. */
export interface OriginalFileProperties {
  format: ContainerFormat;
  formatLabel: string;
  sampleRate: number | null;
  channelCount: number | null;
  bitDepth: number | null;
  /** Codec detail, e.g. "PCM integer" or "MPEG-1 Layer III". */
  encoding: string | null;
}

const LABELS: Record<ContainerFormat, string> = {
  wav: "WAV",
  flac: "FLAC",
  mp3: "MP3",
  ogg: "Ogg",
  m4a: "MP4 / M4A",
  aac: "AAC (ADTS)",
  unknown: "Unknown",
};

function result(
  format: ContainerFormat,
  fields: Partial<OriginalFileProperties> = {},
): OriginalFileProperties {
  return {
    format,
    formatLabel: LABELS[format],
    sampleRate: null,
    channelCount: null,
    bitDepth: null,
    encoding: null,
    ...fields,
  };
}

function ascii(view: DataView, offset: number, length: number): string {
  let text = "";
  for (let i = 0; i < length && offset + i < view.byteLength; i++) {
    text += String.fromCharCode(view.getUint8(offset + i));
  }
  return text;
}

function parseWav(view: DataView): OriginalFileProperties {
  let offset = 12;
  while (offset + 8 <= view.byteLength) {
    const id = ascii(view, offset, 4);
    const size = view.getUint32(offset + 4, true);
    if (id === "fmt " && offset + 24 <= view.byteLength) {
      let tag = view.getUint16(offset + 8, true);
      if (tag === 0xfffe && size >= 40 && offset + 34 <= view.byteLength) {
        tag = view.getUint16(offset + 32, true);
      }
      return result("wav", {
        channelCount: view.getUint16(offset + 10, true),
        sampleRate: view.getUint32(offset + 12, true),
        bitDepth: view.getUint16(offset + 22, true),
        encoding: tag === 1 ? "PCM integer" : tag === 3 ? "IEEE float" : `Format tag ${tag}`,
      });
    }
    offset += 8 + size + (size & 1);
  }
  return result("wav");
}

function parseFlac(view: DataView): OriginalFileProperties {
  if (view.byteLength < 26) return result("flac");
  // STREAMINFO, packed big-endian: 20 bits rate, 3 bits channels-1, 5 bits depth-1.
  const packed = view.getUint32(18, false);
  return result("flac", {
    sampleRate: packed >>> 12,
    channelCount: ((packed >>> 9) & 0x7) + 1,
    bitDepth: ((packed >>> 4) & 0x1f) + 1,
    encoding: "FLAC lossless",
  });
}

const MPEG_RATES: Record<number, number[]> = {
  3: [44100, 48000, 32000],
  2: [22050, 24000, 16000],
  0: [11025, 12000, 8000],
};

function parseMp3Frame(view: DataView, offset: number): OriginalFileProperties | null {
  if (offset + 4 > view.byteLength) return null;
  const header = view.getUint32(offset, false);
  if (header >>> 21 !== 0x7ff) return null;
  const version = (header >>> 19) & 0x3;
  const layer = (header >>> 17) & 0x3;
  const rateIndex = (header >>> 10) & 0x3;
  const bitrate = (header >>> 12) & 0xf;
  if (version === 1 || layer !== 1 || rateIndex === 3 || bitrate === 0 || bitrate === 15) {
    return null;
  }
  return result("mp3", {
    sampleRate: MPEG_RATES[version][rateIndex],
    channelCount: ((header >>> 6) & 0x3) === 3 ? 1 : 2,
    encoding: `MPEG-${version === 3 ? "1" : version === 2 ? "2" : "2.5"} Layer III`,
  });
}

function parseMp3(view: DataView): OriginalFileProperties | null {
  let offset = 0;
  if (ascii(view, 0, 3) === "ID3" && view.byteLength >= 10) {
    const syncsafe =
      (view.getUint8(6) << 21) |
      (view.getUint8(7) << 14) |
      (view.getUint8(8) << 7) |
      view.getUint8(9);
    offset = 10 + syncsafe;
  }
  return parseMp3Frame(view, offset);
}

function parseOgg(view: DataView): OriginalFileProperties {
  if (view.byteLength < 28) return result("ogg");
  const payload = 27 + view.getUint8(26);
  if (ascii(view, payload, 8) === "OpusHead") {
    return result("ogg", {
      channelCount: view.getUint8(payload + 9),
      // Opus always decodes at 48 kHz; the header's input rate is informational only.
      sampleRate: 48000,
      encoding: "Opus",
    });
  }
  if (ascii(view, payload + 1, 6) === "vorbis" && payload + 16 <= view.byteLength) {
    return result("ogg", {
      channelCount: view.getUint8(payload + 11),
      sampleRate: view.getUint32(payload + 12, true),
      encoding: "Vorbis",
    });
  }
  if (ascii(view, payload, 5) === "\x7fFLAC") {
    return result("ogg", { encoding: "FLAC in Ogg" });
  }
  return result("ogg");
}

const ADTS_RATES = [
  96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350,
];

function parseAdts(view: DataView): OriginalFileProperties | null {
  if (view.byteLength < 4) return null;
  const header = view.getUint32(0, false);
  if (header >>> 20 !== 0xfff || ((header >>> 17) & 0x3) !== 0) return null;
  const rate = ADTS_RATES[(header >>> 10) & 0xf];
  if (rate === undefined) return null;
  return result("aac", { sampleRate: rate, encoding: "AAC" });
}

/** Identifies a file by its leading bytes; the extension and MIME type are not trusted. */
export function identifyAudioFile(bytes: ArrayBuffer): OriginalFileProperties {
  const view = new DataView(bytes);
  if (ascii(view, 0, 4) === "RIFF" && ascii(view, 8, 4) === "WAVE") return parseWav(view);
  if (ascii(view, 0, 4) === "fLaC") return parseFlac(view);
  if (ascii(view, 0, 4) === "OggS") return parseOgg(view);
  if (ascii(view, 4, 4) === "ftyp") return result("m4a");
  return parseMp3(view) ?? parseAdts(view) ?? result("unknown");
}
