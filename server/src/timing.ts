// RTT tracking, server-side. The Workers runtime has no process.hrtime — Date.now()
// (wall clock, ms resolution) is used instead. Fine at friends-only scale with
// single-digit-ms round trips; see multiplayer plan for the tradeoff note.

export function serverNowMs(): number {
  return Date.now();
}

const RTT_WINDOW = 8;

export class RttTracker {
  private samples: number[] = [];

  record(rttMs: number) {
    this.samples.push(rttMs);
    if (this.samples.length > RTT_WINDOW) this.samples.shift();
  }

  // Median is more robust to occasional latency spikes than a mean.
  median(): number {
    if (this.samples.length === 0) return 0;
    const sorted = [...this.samples].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }
}

// Server-authoritative reaction time: assumes symmetric one-way latency
// (rtt/2) to back out the instant the client actually hit submit, in the
// server's own clock, then measures against when the round was dealt.
export function estimateReactionMs(
  serverRecvMs: number,
  rttMedianMs: number,
  dealtAtServerMs: number
): number {
  const oneWayDelay = rttMedianMs / 2;
  const estimatedSubmitServerMs = serverRecvMs - oneWayDelay;
  return estimatedSubmitServerMs - dealtAtServerMs;
}
