import type {
  JobKind,
  JobMessage,
  JobRequests,
  JobResults,
  WorkerRequest,
  WorkerResponse,
} from "@/workers/protocol";

export class JobCancelled extends Error {}

interface PendingJob {
  kind: JobKind;
  resolve: (result: never) => void;
  reject: (error: Error) => void;
  onProgress?: (value: number) => void;
}

/** Main-thread handle on the analysis worker. A new job supersedes any running job of its kind. */
export class AnalysisClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, PendingJob>();
  /** Called if the worker itself dies, so the UI can report it. */
  onWorkerFailure: (() => void) | null = null;

  private ensureWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL("../../workers/analysis.worker.ts", import.meta.url), {
        type: "module",
      });
      this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => this.receive(event.data);
      this.worker.onerror = () => {
        this.worker?.terminate();
        this.worker = null;
        for (const job of this.pending.values()) job.reject(new Error("Analysis worker stopped."));
        this.pending.clear();
        this.onWorkerFailure?.();
      };
    }
    return this.worker;
  }

  private receive(message: WorkerResponse): void {
    const job = this.pending.get(message.id);
    if (!job) return;
    switch (message.type) {
      case "progress":
        job.onProgress?.(message.value);
        return;
      case "done":
        this.pending.delete(message.id);
        job.resolve(message.result as never);
        return;
      case "cancelled":
        this.pending.delete(message.id);
        job.reject(new JobCancelled());
        return;
      case "error":
        this.pending.delete(message.id);
        job.reject(new Error(message.message));
    }
  }

  private send(message: WorkerRequest, transfer: Transferable[] = []): void {
    this.ensureWorker().postMessage(message, transfer);
  }

  /** Hands the worker its own copy of the PCM. This is the only copy the app makes. */
  load(buffer: AudioBuffer): void {
    this.cancelAll();
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) =>
      buffer.getChannelData(c).slice(),
    );
    this.send(
      { type: "load", channels, sampleRate: buffer.sampleRate },
      channels.map((c) => c.buffer),
    );
  }

  /** A second recording for comparison, held beside the main one. */
  loadReference(buffer: AudioBuffer): void {
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) =>
      buffer.getChannelData(c).slice(),
    );
    this.send(
      { type: "loadReference", channels, sampleRate: buffer.sampleRate },
      channels.map((c) => c.buffer),
    );
  }

  clearProcessed(): void {
    if (this.worker) this.send({ type: "clearProcessed" });
  }

  clearReference(): void {
    if (this.worker) this.send({ type: "clearReference" });
  }

  clear(): void {
    this.cancelAll();
    if (this.worker) this.send({ type: "clear" });
  }

  run<K extends JobKind>(
    kind: K,
    request: JobRequests[K],
    onProgress?: (value: number) => void,
  ): Promise<JobResults[K]> {
    this.cancel(kind);
    const id = this.nextId++;
    return new Promise<JobResults[K]>((resolve, reject) => {
      this.pending.set(id, {
        kind,
        resolve: resolve as (result: never) => void,
        reject,
        onProgress,
      });
      this.send({ type: "job", id, kind, request } as JobMessage);
    });
  }

  cancel(kind: JobKind): void {
    for (const [id, job] of this.pending) {
      if (job.kind === kind) this.send({ type: "cancel", id });
    }
  }

  cancelAll(): void {
    for (const id of this.pending.keys()) this.send({ type: "cancel", id });
  }
}
