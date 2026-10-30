/** Encodes floating-point channels as a 16-bit PCM WAV file. */
export function encodeWav16(channels: Float32Array[], sampleRate: number): ArrayBuffer {
  const frames = channels[0].length;
  const channelCount = channels.length;
  const dataBytes = frames * channelCount * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const tag = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  tag(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channelCount * 2, true);
  view.setUint16(32, channelCount * 2, true);
  view.setUint16(34, 16, true);
  tag(36, "data");
  view.setUint32(40, dataBytes, true);
  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channelCount; c++) {
      const x = Math.max(-1, Math.min(1, channels[c][i]));
      view.setInt16(offset, Math.round(x < 0 ? x * 32768 : x * 32767), true);
      offset += 2;
    }
  }
  return buffer;
}
