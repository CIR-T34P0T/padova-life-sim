// How long the server's simulation tick takes (M11): a rolling window of the
// latest ticks, summarised for the log and for tests against
// NPC_CONFIG.tickBudgetMs. Measuring costs two clock reads per tick.

export interface TickSummary {
  ticks: number;
  avgMs: number;
  p95Ms: number;
  maxMs: number;
}

export class TickStats {
  private readonly samples: Float64Array;
  private count = 0;
  private next = 0;

  constructor(window = 1_200) {
    this.samples = new Float64Array(window);
  }

  record(ms: number): void {
    this.samples[this.next] = ms;
    this.next = (this.next + 1) % this.samples.length;
    this.count = Math.min(this.count + 1, this.samples.length);
  }

  summary(): TickSummary {
    if (this.count === 0) return { ticks: 0, avgMs: 0, p95Ms: 0, maxMs: 0 };
    const values = Array.from(this.samples.subarray(0, this.count)).sort((a, b) => a - b);
    const sum = values.reduce((total, v) => total + v, 0);
    return { ticks: this.count, avgMs: sum / this.count, p95Ms: values[Math.min(values.length - 1, Math.floor(values.length * 0.95))]!, maxMs: values[values.length - 1]! };
  }
}
