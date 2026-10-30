export const COLOR_MAPS = {
  magma: "000004,180f3d,440f76,721f81,9e2f7f,cd4071,f1605d,fd9668,feca8d,fcfdbf",
  inferno: "000004,1b0c41,4a0c6b,781c6d,a52c60,cf4446,ed6925,fb9b06,f7d13d,fcffa4",
  viridis: "440154,482878,3e4989,31688e,26828e,1f9e89,35b779,6ece58,b5de2b,fde725",
  grayscale: "000000,ffffff",
} as const;

export type ColorMapName = keyof typeof COLOR_MAPS;

const cache = new Map<ColorMapName, Uint32Array>();

/** 256-entry lookup table of little-endian RGBA pixels, ready for an ImageData Uint32Array view. */
export function colorMapLut(name: ColorMapName): Uint32Array {
  const cached = cache.get(name);
  if (cached) return cached;
  const stops = COLOR_MAPS[name].split(",").map((hex) => {
    const value = parseInt(hex, 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  });
  const lut = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    const position = (i / 255) * (stops.length - 1);
    const index = Math.min(stops.length - 2, Math.floor(position));
    const t = position - index;
    const [r, g, b] = [0, 1, 2].map((c) =>
      Math.round(stops[index][c] + t * (stops[index + 1][c] - stops[index][c])),
    );
    lut[i] = ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
  }
  cache.set(name, lut);
  return lut;
}
