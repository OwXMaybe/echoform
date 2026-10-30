/** Flattens stacked canvases and saves them as a PNG. Nothing leaves the browser. */
export function saveCanvasesAsPng(canvases: HTMLCanvasElement[], fileName: string): void {
  const [first] = canvases;
  const output = document.createElement("canvas");
  output.width = first.width;
  output.height = first.height;
  const ctx = output.getContext("2d");
  if (!ctx) return;
  for (const canvas of canvases) ctx.drawImage(canvas, 0, 0);
  output.toBlob((blob) => {
    if (blob) saveBlob(blob, fileName);
  }, "image/png");
}

/** Hands a file to the browser's download. The object URL outlives the click briefly. */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function chartFileName(recordingName: string | undefined, chart: string): string {
  const base = (recordingName ?? "recording").replace(/\.[^.]+$/, "");
  return `${base}-${chart}.png`;
}
