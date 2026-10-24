import { fixtures } from "@domino/contracts/fixtures";
import { describe, expect, it } from "vitest";
import { timelineGeometry } from "./geometry";
import {
  MAX_PARTICLES,
  MAX_TRACKS,
  PATH_SAMPLES,
  morphAmount,
  prepareParticleField,
  readParticlePoint,
  sampleParticlePath,
} from "./particles";

const original = { key: "sample", path: "M0,0C30,0,60,90,90,90", withinLimits: true };

describe("bounded display-space particles", () => {
  it("samples real D3 paths without changing their endpoints", () => {
    const graph = timelineGeometry(
      fixtures.history,
      fixtures.snapshot.asOf,
      fixtures.resilience,
      fixtures.resilienceWithFixes,
      300_000_000,
      1280,
    );
    for (const future of fixtures.resilience.universes) {
      const points = graph.points(future);
      const samples = sampleParticlePath(graph.path(points) ?? "");
      expect(samples).toHaveLength(PATH_SAMPLES * 2);
      expect(samples?.every(Number.isFinite)).toBe(true);
      expect(samples?.[0]).toBeCloseTo(
        graph.x(Date.parse(`${fixtures.snapshot.asOf}T00:00:00Z`)),
        3,
      );
      expect(samples?.at(-2)).toBeCloseTo(graph.right, 3);
    }
    expect(sampleParticlePath("")).toBeUndefined();
    expect(sampleParticlePath("M0,0Q3,4,5,6")).toBeUndefined();
    expect(sampleParticlePath("M0,0C1,2")).toBeUndefined();
  });
  it("bounds density and geometry even for hundreds of scenarios", () => {
    const tracks = Array.from({ length: 500 }, (_, index) => ({
      ...original,
      key: `track-${index}`,
    }));
    const field = prepareParticleField(tracks, undefined, 0);
    expect(field.tracks.length).toBeLessThanOrEqual(MAX_TRACKS);
    expect(field.particles.length).toBeLessThanOrEqual(MAX_PARTICLES);
    expect(prepareParticleField(tracks, undefined, 0, 48).particles.length).toBeLessThanOrEqual(48);
    expect(prepareParticleField([], undefined, 0).particles).toEqual([]);
    expect(prepareParticleField([original], undefined, 0).particles).toEqual(
      prepareParticleField([original], undefined, 0).particles,
    );
  });
  it("keeps a morph continuous when a fix preview changes again halfway through", () => {
    const first = prepareParticleField([original], undefined, 0);
    const second = prepareParticleField(
      [{ ...original, path: "M0,30C30,30,60,120,90,120" }],
      first,
      1,
    );
    const third = prepareParticleField([original], second, 1.3);
    const before = new Float32Array(2);
    const after = new Float32Array(2);
    const secondTrack = second.tracks[0];
    const thirdTrack = third.tracks[0];
    if (!secondTrack || !thirdTrack) throw new Error("Missing sampled track");
    readParticlePoint(secondTrack, 0.5, morphAmount(0.3), before);
    readParticlePoint(thirdTrack, 0.5, 0, after);
    expect(after[0]).toBeCloseTo(before[0] ?? 0, 4);
    expect(after[1]).toBeCloseTo(before[1] ?? 0, 4);
    expect(third.particles).toEqual(first.particles);
  });
  it("clamps point reads and morph progress to finite endpoints", () => {
    const field = prepareParticleField([original], undefined, 0);
    const track = field.tracks[0];
    if (!track) throw new Error("Missing sampled track");
    const output = new Float32Array(2);
    readParticlePoint(track, -1, 1, output);
    expect([...output]).toEqual([0, 0]);
    readParticlePoint(track, 2, 1, output);
    expect([...output]).toEqual([90, 90]);
    expect(morphAmount(-1)).toBe(0);
    expect(morphAmount(1)).toBe(1);
  });
});
