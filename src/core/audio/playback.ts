export interface LoopRange {
  start: number;
  end: number;
}

/** Sample-accurate playback of one AudioBuffer. Owns a single AudioContext for its lifetime. */
export class PlaybackEngine {
  private context: AudioContext | null = null;
  private gain: GainNode | null = null;
  private source: AudioBufferSourceNode | null = null;
  private buffer: AudioBuffer | null = null;
  private startedAt = 0;
  private offset = 0;
  private rate = 1;
  private gainValue = 1;
  private loop: LoopRange | null = null;

  /** Called when playback reaches the end of the recording by itself. */
  onEnded: (() => void) | null = null;

  get playing(): boolean {
    return this.source !== null;
  }

  load(buffer: AudioBuffer | null): void {
    this.halt();
    this.buffer = buffer;
    this.offset = 0;
  }

  /** Replaces the audio with a buffer of the same length, keeping the position. */
  swapBuffer(buffer: AudioBuffer): void {
    this.applyWhilePlaying(() => {
      this.buffer = buffer;
    });
  }

  position(): number {
    if (!this.source || !this.context) return this.offset;
    const latency = this.context.outputLatency || 0;
    const elapsed = Math.max(0, this.context.currentTime - this.startedAt - latency) * this.rate;
    const raw = this.offset + elapsed;
    if (this.loop && raw >= this.loop.end) {
      const span = this.loop.end - this.loop.start;
      return this.loop.start + ((raw - this.loop.start) % span);
    }
    return Math.min(raw, this.buffer?.duration ?? 0);
  }

  async play(): Promise<void> {
    if (!this.buffer || this.source) return;
    if (!this.context) {
      this.context = new AudioContext();
      this.gain = this.context.createGain();
      this.gain.gain.value = this.gainValue;
      this.gain.connect(this.context.destination);
    }
    // Browsers keep a context suspended until a user gesture resumes it.
    if (this.context.state === "suspended") await this.context.resume();
    if (this.offset >= this.buffer.duration) this.offset = 0;
    this.start();
  }

  private start(): void {
    const source = this.context!.createBufferSource();
    source.buffer = this.buffer;
    source.playbackRate.value = this.rate;
    let from = this.offset;
    if (this.loop) {
      source.loop = true;
      source.loopStart = this.loop.start;
      source.loopEnd = this.loop.end;
      if (from < this.loop.start || from >= this.loop.end) from = this.loop.start;
    }
    source.connect(this.gain!);
    source.onended = () => {
      if (this.source !== source) return;
      this.source = null;
      this.offset = this.buffer?.duration ?? 0;
      this.onEnded?.();
    };
    source.start(0, from);
    this.offset = from;
    this.startedAt = this.context!.currentTime;
    this.source = source;
  }

  private halt(): void {
    const source = this.source;
    if (!source) return;
    this.source = null;
    source.onended = null;
    source.stop();
    source.disconnect();
  }

  pause(): void {
    this.offset = this.position();
    this.halt();
  }

  stop(): void {
    this.halt();
    this.offset = this.loop?.start ?? 0;
  }

  seek(seconds: number): void {
    const duration = this.buffer?.duration ?? 0;
    const target = Math.max(0, Math.min(duration, seconds));
    const wasPlaying = this.playing;
    this.halt();
    this.offset = target;
    if (wasPlaying) this.start();
  }

  /** Source nodes are one-shot, so changing their parameters restarts from the current position. */
  private applyWhilePlaying(change: () => void): void {
    const wasPlaying = this.playing;
    if (wasPlaying) {
      this.offset = this.position();
      this.halt();
    }
    change();
    if (wasPlaying) this.start();
  }

  setRate(rate: number): void {
    this.applyWhilePlaying(() => {
      this.rate = rate;
    });
  }

  setLoop(loop: LoopRange | null): void {
    this.applyWhilePlaying(() => {
      this.loop = loop;
    });
  }

  setGain(gain: number): void {
    this.gainValue = gain;
    if (this.gain && this.context) {
      this.gain.gain.setTargetAtTime(gain, this.context.currentTime, 0.01);
    }
  }

  async dispose(): Promise<void> {
    this.load(null);
    const context = this.context;
    this.context = null;
    this.gain = null;
    await context?.close();
  }
}
