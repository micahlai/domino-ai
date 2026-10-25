export type LabelBox = { left: number; top: number; width: number; height: number };
export type ChartAnnotation = { id: string; x: number; y: number; text: string };
export type PlacedAnnotation = ChartAnnotation & LabelBox & { lines: string[] };

// Conservative bounds for the chart's native 11px labels; financial values are never changed.
export function annotationWidth(text: string): number {
  return [...text].reduce(
    (width, char) =>
      width + (/\s/.test(char) ? 4 : /[il.,:'!|]/.test(char) ? 4 : /[MW@#]/.test(char) ? 11 : 7.5),
    0,
  );
}
export function annotationOverlap(a: LabelBox, b: LabelBox): boolean {
  return (
    a.left < b.left + b.width + 6 &&
    a.left + a.width + 6 > b.left &&
    a.top < b.top + b.height + 6 &&
    a.top + a.height + 6 > b.top
  );
}
function wrapLabel(text: string, width: number): string[] {
  const lines = [""];
  for (const word of text.split(/\s+/)) {
    const current = lines.at(-1) ?? "";
    const next = current ? `${current} ${word}` : word;
    if (annotationWidth(next) <= width) lines[lines.length - 1] = next;
    else if (current) lines.push(word);
    else lines[lines.length - 1] = word;
  }
  return lines.slice(0, 2).map((line, index) => {
    let shown = line;
    const truncated = annotationWidth(shown) > width || (index === 1 && lines.length > 2);
    while (shown && annotationWidth(`${shown}${truncated ? "…" : ""}`) > width)
      shown = shown.slice(0, -1);
    return `${shown}${truncated ? "…" : ""}`;
  });
}

/** Place nearby notes in separate lanes; dense overflow keeps its dot and readable receipt list. */
export function placeChartAnnotations(
  labels: ChartAnnotation[],
  bounds: LabelBox,
  reserved: LabelBox[] = [],
): { placed: PlacedAnnotation[]; overflow: ChartAnnotation[] } {
  const placed: PlacedAnnotation[] = [];
  const overflow: ChartAnnotation[] = [];
  const right = bounds.left + bounds.width;
  const bottom = bounds.top + bounds.height;
  const visible = labels.filter(
    (label) =>
      label.x >= bounds.left - 8 &&
      label.x <= right + 8 &&
      label.y >= bounds.top - 8 &&
      label.y <= bottom + 8,
  );
  const points = visible.map((label) => ({
    left: label.x - 4,
    top: label.y - 4,
    width: 8,
    height: 8,
  }));
  for (const label of visible) {
    const maxWidth = Math.min(220, bounds.width);
    const lines = wrapLabel(label.text, maxWidth);
    const width = Math.min(maxWidth, Math.max(...lines.map(annotationWidth), 1));
    const height = lines.length * 14;
    const clampX = (x: number) => Math.max(bounds.left, Math.min(right - width, x));
    const candidates: LabelBox[] = [];
    // Scan whole rows to guarantee bounds and separation even for a dense stack of breaches.
    for (let top = bounds.top; top + height <= bottom; top += height + 8)
      for (const left of [
        clampX(label.x + 9),
        clampX(label.x - width - 9),
        bounds.left,
        right - width,
      ])
        candidates.push({ left, top, width, height });
    candidates.sort(
      (a, b) =>
        Math.abs(a.top - label.y) +
        Math.abs(a.left - label.x) -
        Math.abs(b.top - label.y) -
        Math.abs(b.left - label.x),
    );
    const box = candidates.find(
      (candidate) =>
        !reserved.some((other) => annotationOverlap(candidate, other)) &&
        !placed.some((other) => annotationOverlap(candidate, other)) &&
        !points.some((point) => annotationOverlap(candidate, point)),
    );
    if (box) placed.push({ ...label, ...box, lines });
    else overflow.push(label);
  }
  return { placed, overflow };
}
