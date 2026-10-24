"use client";

import { useEffect, useRef } from "react";
import {
  MAX_PARTICLES,
  type ParticleField,
  type ParticleTrack,
  morphAmount,
  prepareParticleField,
  readParticlePoint,
} from "./particles";

interface Props {
  tracks: ParticleTrack[];
  width: number;
  height: number;
  activeKey?: string;
  enabled: boolean;
}

export function TimelineParticles({ tracks, width, height, activeKey, enabled }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const field = useRef<ParticleField | undefined>(undefined);
  const elapsed = useRef(0);
  const settings = useRef({ activeKey, enabled });
  const synchronize = useRef<(() => void) | undefined>(undefined);

  useEffect(() => {
    const budget = Math.min(
      MAX_PARTICLES,
      Math.max(160, Math.round(Math.min(width, window.innerWidth) * 0.6)),
    );
    field.current = prepareParticleField(tracks, field.current, elapsed.current, budget);
    if (canvas.current)
      canvas.current.dataset.particleCount = String(field.current.particles.length);
    synchronize.current?.();
  }, [tracks, width]);

  useEffect(() => {
    settings.current = { activeKey, enabled };
    synchronize.current?.();
  }, [activeKey, enabled]);

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const drawing = element.getContext("2d", { alpha: true });
    if (!drawing) return;
    const surface: HTMLCanvasElement = element;
    const context: CanvasRenderingContext2D = drawing;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    surface.width = Math.round(width * dpr);
    surface.height = Math.round(height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    const style = getComputedStyle(surface);
    const color = (token: string) => `hsl(${style.getPropertyValue(token).trim()})`;
    const palette = {
      primary: color("--primary"),
      history: color("--clay"),
      neutral: color("--muted-foreground"),
      danger: color("--destructive"),
      glint: color("--foreground"),
    };
    const scratch = new Float32Array(2);
    const tangent = new Float32Array(2);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame: number | undefined;
    let lastTime = 0;
    let visible = false;
    let drawTotal = 0;
    let frames = 0;
    let measuredFrom = 0;
    let slowFrames = 0;
    let frameInterval = window.matchMedia("(pointer: coarse)").matches ? 1000 / 30 : 1000 / 60;

    function draw(time: number, settle = false) {
      const current = field.current;
      context.clearRect(0, 0, width, height);
      if (!current) return;
      context.globalCompositeOperation = "lighter";
      const blend = settle ? 1 : morphAmount(time - current.changed);
      const selected = settings.current.activeKey;
      for (const particle of current.particles) {
        const track = current.tracks[particle.track];
        if (!track || time < track.introduced) continue;
        const age = ((time - track.introduced) / particle.lifespan + particle.phase) % 1;
        const progress = particle.origin;
        const active = selected === track.key;
        const reveal = Math.min(1, (time - track.introduced) / 0.6);
        if (progress > reveal) continue;
        readParticlePoint(track, progress, blend, scratch);
        readParticlePoint(track, Math.min(1, progress + 0.006), blend, tangent);
        const baseX = scratch[0] ?? 0;
        const baseY = scratch[1] ?? 0;
        const dx = (tangent[0] ?? baseX + 1) - baseX;
        const dy = (tangent[1] ?? baseY) - baseY;
        const length = Math.hypot(dx, dy) || 1;
        const normalX = -dy / length;
        const normalY = dx / length;
        const distance = particle.spread * (age * 0.4 + age * age * 0.6);
        const travel = particle.drift * age;
        const x = baseX + normalX * distance + (dx / length) * travel;
        const y = baseY + normalY * distance + (dy / length) * travel;
        const envelope = Math.min(1, age * 9) * (1 - age) ** 1.1;
        const emphasis = track.history ? 0.5 : active ? 0.9 : selected ? 0.38 : 0.66;
        const alpha = emphasis * envelope * particle.depth;
        const tone = track.history
          ? palette.history
          : active || track.withinLimits
            ? palette.primary
            : baseX >= (track.breakX ?? Number.POSITIVE_INFINITY)
              ? palette.danger
              : palette.neutral;
        context.fillStyle = tone;
        context.globalAlpha = alpha;
        const radius = (0.6 + particle.depth * 0.7) * (1 - age * 0.3);
        context.beginPath();
        context.arc(x, y, radius, 0, Math.PI * 2);
        context.fill();
        // Small scattered halos suggest emissive dust without a full-canvas blur pass.
        if (particle.phase > 0.82) {
          context.globalAlpha = alpha * 0.11;
          context.beginPath();
          context.arc(x, y, radius * 3.8, 0, Math.PI * 2);
          context.fill();
        }
        if (active && particle.phase > 0.7 && age < 0.5) {
          context.fillStyle = palette.glint;
          context.globalAlpha = alpha * 0.65;
          context.fillRect(x - 0.35, y - 0.35, 0.7, 0.7);
        }
      }
      context.globalAlpha = 1;
      context.globalCompositeOperation = "source-over";
    }

    function tick(now: number) {
      frame = undefined;
      if (!visible || document.hidden || reducedMotion.matches || !settings.current.enabled) return;
      if (lastTime && now - lastTime < frameInterval - 1) {
        frame = requestAnimationFrame(tick);
        return;
      }
      const delta = lastTime ? Math.min(0.1, (now - lastTime) / 1000) : 0;
      lastTime = now;
      elapsed.current += delta;
      const started = performance.now();
      draw(elapsed.current);
      const cost = performance.now() - started;
      drawTotal += cost;
      frames++;
      slowFrames = cost > 5 ? slowFrames + 1 : Math.max(0, slowFrames - 1);
      if (slowFrames > 10) frameInterval = 1000 / 30;
      if (!measuredFrom) measuredFrom = now;
      if (now - measuredFrom >= 1000) {
        surface.dataset.particleRenderMs = (drawTotal / frames).toFixed(2);
        surface.dataset.particleFps = ((frames * 1000) / (now - measuredFrom)).toFixed(0);
        surface.dataset.particleCount = String(field.current?.particles.length ?? 0);
        measuredFrom = now;
        drawTotal = 0;
        frames = 0;
      }
      frame = requestAnimationFrame(tick);
    }

    function sync() {
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = undefined;
      lastTime = 0;
      const running =
        visible && !document.hidden && !reducedMotion.matches && settings.current.enabled;
      surface.dataset.motionState = reducedMotion.matches
        ? "reduced"
        : running
          ? "running"
          : !settings.current.enabled
            ? "off"
            : document.hidden
              ? "hidden"
              : "offscreen";
      // A stopped overlay must resume on the current forecast, without replaying stale geometry.
      if (!running && field.current) {
        for (const track of field.current.tracks) track.from = track.to;
        field.current.changed = elapsed.current - 0.6;
      }
      if (reducedMotion.matches || !settings.current.enabled)
        context.clearRect(0, 0, width, height);
      else draw(elapsed.current, !running);
      if (running) {
        measuredFrom = 0;
        drawTotal = 0;
        frames = 0;
        frame = requestAnimationFrame(tick);
      }
    }
    synchronize.current = sync;
    const observer = new IntersectionObserver(
      ([entry]) => {
        visible = entry?.isIntersecting ?? false;
        sync();
      },
      { threshold: 0.01 },
    );
    observer.observe(surface);
    document.addEventListener("visibilitychange", sync);
    reducedMotion.addEventListener("change", sync);
    sync();
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener("visibilitychange", sync);
      reducedMotion.removeEventListener("change", sync);
      synchronize.current = undefined;
    };
  }, [width, height]);

  return (
    <canvas
      ref={canvas}
      tabIndex={-1}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-10"
      style={{ width, height }}
      data-timeline-particles=""
    />
  );
}
