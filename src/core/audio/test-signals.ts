/** Deterministic synthetic signals with known properties, for tests and the built-in demo. */

export function sine(
  frequency: number,
  amplitude: number,
  sampleRate: number,
  length: number,
  phase = 0,
): Float32Array {
  const out = new Float32Array(length);
  for (let n = 0; n < length; n++) {
    out[n] = amplitude * Math.sin((2 * Math.PI * frequency * n) / sampleRate + phase);
  }
  return out;
}

export function addSignals(...signals: Float32Array[]): Float32Array {
  const out = new Float32Array(signals[0].length);
  for (const signal of signals) {
    for (let n = 0; n < out.length; n++) out[n] += signal[n];
  }
  return out;
}

/** Linear sine sweep from f0 to f1 over the whole length. */
export function sweep(
  f0: number,
  f1: number,
  amplitude: number,
  sampleRate: number,
  length: number,
): Float32Array {
  const out = new Float32Array(length);
  const duration = length / sampleRate;
  const rate = (f1 - f0) / duration;
  for (let n = 0; n < length; n++) {
    const t = n / sampleRate;
    out[n] = amplitude * Math.sin(2 * Math.PI * (f0 * t + 0.5 * rate * t * t));
  }
  return out;
}

/** Uniform white noise from a seeded xorshift generator, so tests are repeatable. */
export function whiteNoise(amplitude: number, length: number, seed = 0x9e3779b9): Float32Array {
  const out = new Float32Array(length);
  let state = seed >>> 0;
  for (let n = 0; n < length; n++) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    out[n] = amplitude * (state / 0x7fffffff - 1);
  }
  return out;
}

export interface DemoSignal {
  name: string;
  description: string;
  sampleRate: number;
  channels: Float32Array[];
}

/**
 * Six-second stereo test recording: a 220 Hz harmonic tone in both channels for three
 * seconds, a 200 Hz to 8 kHz sweep on the left against a steady 1 kHz tone on the right,
 * then one second of digital silence.
 */
export function createDemoSignal(): DemoSignal {
  const sampleRate = 48000;
  const length = sampleRate * 6;
  const left = new Float32Array(length);
  const right = new Float32Array(length);

  const toneLength = sampleRate * 3;
  const tone = addSignals(
    sine(220, 0.4, sampleRate, toneLength),
    sine(440, 0.2, sampleRate, toneLength),
    sine(660, 0.1, sampleRate, toneLength),
  );
  left.set(tone, 0);
  right.set(tone, 0);

  const sweepLength = sampleRate * 2;
  left.set(sweep(200, 8000, 0.5, sampleRate, sweepLength), toneLength);
  right.set(sine(1000, 0.25, sampleRate, sweepLength), toneLength);

  return {
    name: "echoform-test-signal.wav",
    description: "Harmonic tone, stereo sweep and silence, generated in your browser.",
    sampleRate,
    channels: [left, right],
  };
}
