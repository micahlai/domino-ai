// Camera rules for the brain map, kept pure so they are easy to test. The camera fits the whole
// map once, on the first load with data. After that a data update never jumps the view: if the
// map grew past the visible area and the person has not moved the camera, it eases out (zoom
// out and pan, never in) just enough to show everything. Once a person drags, pinches or zooms,
// only the fit button moves the camera again. Container resizes never change the view.

export type CameraState = { fitted: boolean; moved: boolean };
export type CameraEvent = "ready" | "data" | "resize" | "user-move" | "fit";
export type Viewport = { x: number; y: number; zoom: number };
export type Bounds = { x: number; y: number; w: number; h: number };

export const INITIAL_CAMERA: CameraState = { fitted: false, moved: false };

export function cameraStep(
  state: CameraState,
  event: CameraEvent,
): { state: CameraState; fit: boolean; grow?: boolean } {
  switch (event) {
    case "ready":
      return state.fitted
        ? { state, fit: false }
        : { state: { fitted: true, moved: false }, fit: true };
    case "user-move":
      return { state: { ...state, moved: true }, fit: false };
    case "fit":
      return { state: { fitted: true, moved: false }, fit: true };
    case "data":
      // New cards may need room: ease out to show them, unless the person took the camera.
      return { state, fit: false, grow: state.fitted && !state.moved };
    default:
      // Resizes: the view stays exactly where it is.
      return { state, fit: false };
  }
}

/** The viewport that shows all of `bounds` centered in a `width` x `height` canvas. */
export function fitViewport(
  bounds: Bounds,
  width: number,
  height: number,
  { padding = 24, minZoom = 0.5, maxZoom = 1 } = {},
): Viewport {
  const zx = (width - padding * 2) / Math.max(1, bounds.w);
  const zy = (height - padding * 2) / Math.max(1, bounds.h);
  const zoom = Math.min(maxZoom, Math.max(minZoom, Math.min(zx, zy)));
  return {
    x: width / 2 - (bounds.x + bounds.w / 2) * zoom,
    y: height / 2 - (bounds.y + bounds.h / 2) * zoom,
    zoom,
  };
}

/** How long the camera eases out when the map grows past the view. */
export const GROW_MS = 500;

/**
 * After the map grows: undefined while `bounds` still shows inside the canvas at the current
 * view, else the view that fits it without zooming in past the current zoom.
 */
export function grownViewport(
  current: Viewport,
  bounds: Bounds,
  width: number,
  height: number,
  { padding = 24, minZoom = 0.5 } = {},
): Viewport | undefined {
  const x0 = bounds.x * current.zoom + current.x;
  const y0 = bounds.y * current.zoom + current.y;
  const x1 = (bounds.x + bounds.w) * current.zoom + current.x;
  const y1 = (bounds.y + bounds.h) * current.zoom + current.y;
  // A pixel of slack, so rounding never starts a move.
  const fits = x0 >= -1 && y0 >= -1 && x1 <= width + 1 && y1 <= height + 1;
  if (fits) return undefined;
  return fitViewport(bounds, width, height, {
    padding,
    minZoom: Math.min(minZoom, current.zoom),
    maxZoom: current.zoom,
  });
}
