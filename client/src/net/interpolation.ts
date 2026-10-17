// Snapshot interpolation: remote state arrives in discrete patches (every
// ~50 ms). Rendering slightly in the past and blending between the two
// surrounding snapshots gives smooth motion without guessing ahead.

export interface Snapshot {
  t: number;
  x: number;
  z: number;
  rotation: number;
  moving: boolean;
}

const MAX_SNAPSHOTS = 32;

export class SnapshotBuffer {
  private readonly snapshots: Snapshot[] = [];

  push(snapshot: Snapshot): void {
    this.snapshots.push(snapshot);
    if (this.snapshots.length > MAX_SNAPSHOTS) this.snapshots.shift();
  }

  /** Pose at `renderTime`. Holds the newest pose when no newer data exists. */
  sample(renderTime: number): Snapshot | null {
    const list = this.snapshots;
    if (list.length === 0) return null;
    const first = list[0];
    if (!first || renderTime <= first.t) return first ?? null;
    for (let i = list.length - 1; i >= 0; i--) {
      const older = list[i];
      if (!older || older.t > renderTime) continue;
      const newer = list[i + 1];
      if (!newer) return older;
      const span = newer.t - older.t;
      const alpha = span > 0 ? (renderTime - older.t) / span : 1;
      return {
        t: renderTime,
        x: older.x + (newer.x - older.x) * alpha,
        z: older.z + (newer.z - older.z) * alpha,
        rotation: lerpAngle(older.rotation, newer.rotation, alpha),
        moving: newer.moving,
      };
    }
    return list.at(-1) ?? null;
  }
}

function lerpAngle(a: number, b: number, t: number): number {
  let delta = (b - a) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return a + delta * t;
}
