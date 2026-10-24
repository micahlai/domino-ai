/** Display-space geometry only. Particles never calculate or change forecast values. */
export interface ParticleTrack {
  key: string;
  path: string;
  probability: number;
  history?: boolean;
  withinLimits: boolean;
  breakX?: number;
}

export const MAX_TRACKS = 32;
export const MAX_PARTICLES = 720;
export const PATH_SAMPLES = 112;

type Cubic = readonly [number, number, number, number, number, number, number, number];

/** D3's monotone line emits absolute M/C/L commands. Sample once, never query SVG per frame. */
export function sampleParticlePath(path: string): Float32Array | undefined {
  const tokens = path.match(/[a-zA-Z]|[-+]?(?:\d*\.?\d+)(?:[eE][-+]?\d+)?/g) ?? [];
  if (tokens[0] !== "M") return undefined;
  const curves: Cubic[] = [];
  let cursor = 0;
  let x = 0;
  let y = 0;
  while (cursor < tokens.length) {
    const command = tokens[cursor++];
    if (command === "Z") continue;
    const count = command === "C" ? 6 : command === "M" || command === "L" ? 2 : 0;
    if (!count || cursor + count > tokens.length) return undefined;
    const values = tokens.slice(cursor, cursor + count).map(Number) as [
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    if (!values.every(Number.isFinite)) return undefined;
    cursor += count;
    if (command === "C") {
      curves.push([x, y, values[0], values[1], values[2], values[3], values[4], values[5]]);
      x = values[4];
      y = values[5];
    } else {
      const [endX, endY] = values;
      if (command === "L") curves.push([x, y, x, y, endX, endY, endX, endY]);
      x = endX;
      y = endY;
    }
  }
  if (!curves.length) return undefined;
  const result = new Float32Array(PATH_SAMPLES * 2);
  for (let index = 0; index < PATH_SAMPLES; index++) {
    const progress = (index / (PATH_SAMPLES - 1)) * curves.length;
    const segment = Math.min(curves.length - 1, Math.floor(progress));
    const t = progress - segment;
    const inverse = 1 - t;
    const curve = curves[segment];
    if (!curve) return undefined;
    const cubic = (a: number, b: number, c: number, d: number) =>
      inverse ** 3 * a + 3 * inverse ** 2 * t * b + 3 * inverse * t ** 2 * c + t ** 3 * d;
    result[index * 2] = cubic(curve[0], curve[2], curve[4], curve[6]);
    result[index * 2 + 1] = cubic(curve[1], curve[3], curve[5], curve[7]);
  }
  return result;
}

export interface SampledTrack extends ParticleTrack {
  from: Float32Array;
  to: Float32Array;
  introduced: number;
}
export interface Particle {
  track: number;
  phase: number;
  lifespan: number;
  origin: number;
  spread: number;
  drift: number;
  depth: number;
}
export interface ParticleField {
  tracks: SampledTrack[];
  particles: Particle[];
  changed: number;
}

function seed(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++)
    hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  // Avalanche neighboring emitter IDs so adjacent births don't form traveling dotted waves.
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b);
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
  hash ^= hash >>> 16;
  return (hash >>> 0) / 4294967296;
}

export function morphAmount(elapsed: number) {
  const t = Math.max(0, Math.min(1, elapsed / 0.6));
  return t * t * (3 - 2 * t);
}

export function prepareParticleField(
  input: ParticleTrack[],
  previous: ParticleField | undefined,
  time: number,
  budget = MAX_PARTICLES,
): ParticleField {
  const oldTracks = new Map(previous?.tracks.map((track) => [track.key, track]));
  const blend = previous ? morphAmount(time - previous.changed) : 1;
  const tracks: SampledTrack[] = [];
  for (const track of input.slice(0, MAX_TRACKS)) {
    const to = sampleParticlePath(track.path);
    if (!to) continue;
    const old = oldTracks.get(track.key);
    const from = old
      ? old.to.map(
          (value, index) =>
            (old.from[index] ?? value) + (value - (old.from[index] ?? value)) * blend,
        )
      : to;
    tracks.push({
      ...track,
      from,
      to,
      introduced: old?.introduced ?? time + (track.history ? 0 : 0.8 + tracks.length * 0.04),
    });
  }
  const particles: Particle[] = [];
  const weights = tracks.map((track) => Math.max(0, Math.min(1, track.probability)));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  const capacity = Math.max(0, Math.floor(Math.min(MAX_PARTICLES, budget)));
  // Largest-remainder allocation preserves relative density while respecting a hard global cap.
  const quotas = weights.map((weight) => (total ? (weight / total) * capacity : 0));
  const counts = quotas.map(Math.floor);
  const ranked = quotas
    .map((quota, index) => ({ index, remainder: quota - (counts[index] ?? 0) }))
    .filter(({ index }) => (weights[index] ?? 0) > 0)
    .sort((a, b) => b.remainder - a.remainder);
  let remaining = total ? capacity - counts.reduce((sum, count) => sum + count, 0) : 0;
  for (const { index } of ranked) {
    if (!remaining) break;
    counts[index] = (counts[index] ?? 0) + 1;
    remaining--;
  }
  tracks.forEach((track, index) => {
    const count = counts[index] ?? 0;
    for (let particle = 0; particle < count; particle++) {
      const phase = seed(`${track.key}:${particle}`);
      particles.push({
        track: index,
        phase,
        // Fixed lifetimes keep particle count and emission rate in the same proportion.
        lifespan: 2.4,
        origin: (particle + seed(`${track.key}:origin:${particle}`)) / count,
        spread: (particle % 2 ? 1 : -1) * (12 + seed(`${track.key}:spread:${particle}`) * 20),
        drift: (seed(`${track.key}:drift:${particle}`) - 0.5) * 12,
        depth: 0.45 + phase * 0.55,
      });
    }
  });
  return { tracks, particles, changed: time };
}

/** Write into a shared scratch buffer so drawing creates no point objects or arrays. */
export function readParticlePoint(
  track: SampledTrack,
  progress: number,
  blend: number,
  output: Float32Array,
) {
  const scaled = Math.max(0, Math.min(1, progress)) * (PATH_SAMPLES - 1);
  const index = Math.min(PATH_SAMPLES - 2, Math.floor(scaled));
  const fraction = scaled - index;
  for (let axis = 0; axis < 2; axis++) {
    const at = index * 2 + axis;
    const before = track.from[at] ?? 0;
    const after = track.to[at] ?? 0;
    const start = before + ((track.from[at + 2] ?? before) - before) * fraction;
    const end = after + ((track.to[at + 2] ?? after) - after) * fraction;
    output[axis] = start + (end - start) * blend;
  }
}
