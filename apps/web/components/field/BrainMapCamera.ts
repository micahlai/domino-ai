// Camera rules for the brain map, kept pure so they are easy to test. The camera fits the whole
// map once, on the first load with data. After that only a person moves it (drag, pinch, the zoom
// buttons, the fit button): data updates, new nodes and container resizes never change zoom or
// position.

export type CameraState = { fitted: boolean; moved: boolean };
export type CameraEvent = "ready" | "data" | "resize" | "user-move" | "fit";
export type Viewport = { x: number; y: number; zoom: number };
export type Bounds = { x: number; y: number; w: number; h: number };

export const INITIAL_CAMERA: CameraState = { fitted: false, moved: false };

export function cameraStep(
  state: CameraState,
  event: CameraEvent,
): { state: CameraState; fit: boolean } {
  switch (event) {
    case "ready":
      return state.fitted
        ? { state, fit: false }
        : { state: { fitted: true, moved: false }, fit: true };
    case "user-move":
      return { state: { ...state, moved: true }, fit: false };
    case "fit":
      return { state: { fitted: true, moved: false }, fit: true };
    default:
      // New events, new nodes, finished helpers, resizes: the view stays exactly where it is.
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
