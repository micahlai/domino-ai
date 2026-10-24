"use client";

import { useEffect, useRef } from "react";
import {
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
    const budget = Math.min(144, Math.max(48, Math.round(Math.min(width, window.innerWidth) / 10)));
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
        const progress = (particle.phase + time * particle.speed) % 1;
        const active = selected === track.key;
        const reveal = Math.min(1, (time - track.introduced) / 0.6);
        if (progress > reveal) continue;
        const alpha =
          (track.history ? 0.42 : active ? 0.78 : selected ? 0.16 : 0.38) * particle.depth;
        readParticlePoint(track, progress, blend, scratch);
        const headX = scratch[0] ?? 0;
        const tone = track.history
          ? palette.history
          : active || track.withinLimits
            ? palette.primary
            : headX >= (track.breakX ?? Number.POSITIVE_INFINITY)
              ? palette.danger
              : palette.neutral;
        const edge = Math.min(1, progress * 18, (1 - progress) * 18);
        context.strokeStyle = tone;
        context.lineWidth = active ? 1.65 : 0.95;
        context.globalAlpha = alpha * edge * 0.4;
        context.beginPath();
        for (let tail = 0; tail < 6; tail++) {
          const position = progress - tail * 0.007;
          if (position < 0) break;
          readParticlePoint(track, position, blend, scratch);
          const x = scratch[0] ?? 0;
          const y =
            (scratch[1] ?? 0) +
            Math.sin(position * 24 + particle.phase * 12) * (active ? 0.55 : 1.15) * particle.depth;
          if (!tail) context.moveTo(x, y);
          else context.lineTo(x, y);
        }
        context.stroke();
        readParticlePoint(track, progress, blend, scratch);
        const headY =
          (scratch[1] ?? 0) +
          Math.sin(progress * 24 + particle.phase * 12) * (active ? 0.55 : 1.15) * particle.depth;
        context.fillStyle = active ? palette.glint : tone;
        context.globalAlpha = alpha * edge;
        context.beginPath();
        context.arc(headX, headY, (active ? 1.65 : 1.2) * particle.depth, 0, Math.PI * 2);
        context.fill();
        if (active) {
          context.fillStyle = tone;
          context.globalAlpha = alpha * edge * 0.075;
          context.beginPath();
          context.arc(headX, headY, 4.5, 0, Math.PI * 2);
          context.fill();
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
            ? "paused"
            : document.hidden
              ? "hidden"
              : "offscreen";
      // A stopped overlay must resume on the current forecast, without replaying stale geometry.
      if (!running && field.current) {
        for (const track of field.current.tracks) track.from = track.to;
        field.current.changed = elapsed.current - 0.6;
      }
      if (reducedMotion.matches) context.clearRect(0, 0, width, height);
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
