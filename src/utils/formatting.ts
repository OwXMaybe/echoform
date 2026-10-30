/** Formats seconds as m:ss.mmm, with precision adapted to the visible span. */
export function formatTime(seconds: number, span = Infinity): string {
  const digits = span < 0.1 ? 4 : span < 2 ? 3 : span < 60 ? 2 : span < 600 ? 1 : 0;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  const text = rest.toFixed(digits).padStart(digits > 0 ? 3 + digits : 2, "0");
  return `${minutes}:${text}`;
}

export function formatTimePrecise(seconds: number): string {
  return formatTime(seconds, 1);
}

export function formatHz(hz: number): string {
  if (hz >= 1000) {
    const k = hz / 1000;
    return `${Number.isInteger(k) ? k : k.toFixed(k >= 10 ? 1 : 2)} kHz`;
  }
  return `${hz >= 100 ? hz.toFixed(0) : hz.toFixed(1)} Hz`;
}

export function formatAxisHz(hz: number): string {
  return hz >= 1000 ? `${+(hz / 1000).toFixed(1)}k` : `${+hz.toFixed(0)}`;
}

export function formatDb(db: number | null, unit = "dBFS"): string {
  if (db === null) return "No signal";
  return `${db.toFixed(2).replace("-", "−")} ${unit}`;
}

export function formatAmplitude(value: number): string {
  return value.toFixed(5).replace("-", "−");
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}
