import { describe, expect, it } from "vitest";
import {
  type LabelBox,
  annotationOverlap,
  annotationWidth,
  placeChartAnnotations,
} from "./chartAnnotations";
const bounds = { left: 80, top: 36, width: 600, height: 230 };
function bounded(box: LabelBox, area: LabelBox) {
  expect(box.left).toBeGreaterThanOrEqual(area.left);
  expect(box.top).toBeGreaterThanOrEqual(area.top);
  expect(box.left + box.width).toBeLessThanOrEqual(area.left + area.width);
  expect(box.top + box.height).toBeLessThanOrEqual(area.top + area.height);
}
describe("chart annotation lanes", () => {
  it("separates labels at nearby breach dots and the lender minimum", () => {
    const result = placeChartAnnotations(
      [
        { id: "limit", x: 85, y: 180, text: "Lender minimum $1,200,000.00" },
        { id: "one", x: 440, y: 192, text: "Short $152,000.00" },
        { id: "two", x: 470, y: 194, text: "Short $156,000.00" },
      ],
      bounds,
    );
    expect(result.placed).toHaveLength(3);
    for (const box of result.placed) bounded(box, bounds);
    for (let i = 0; i < result.placed.length; i++)
      for (let j = i + 1; j < result.placed.length; j++)
        expect(annotationOverlap(result.placed[i]!, result.placed[j]!)).toBe(false);
  });
  it("wraps and clamps labels on narrow plots and retains full original text", () => {
    const narrow = { left: 75, top: 36, width: 160, height: 200 };
    const labels = [
      { id: "left", x: 75, y: 80, text: "Lender's very long cash minimum $1,000,000.00" },
      { id: "right", x: 235, y: 170, text: "Short $123,456.78" },
    ];
    const result = placeChartAnnotations(labels, narrow);
    expect(result.placed).toHaveLength(2);
    for (const label of result.placed) {
      bounded(label, narrow);
      expect(label.lines.length).toBeLessThanOrEqual(2);
      expect(label.lines.every((line) => annotationWidth(line) <= narrow.width)).toBe(true);
      expect(label.text).toBe(labels.find((original) => original.id === label.id)!.text);
    }
  });
  it("avoids an expanded chart key and moves dense overflow to receipts instead of overlapping", () => {
    const key = { left: 88, top: 34, width: 180, height: 140 };
    const labels = Array.from({ length: 40 }, (_, i) => ({
      id: `${i}`,
      x: 200,
      y: 120,
      text: `Short $${i},000.00`,
    }));
    const result = placeChartAnnotations(labels, bounds, [key]);
    expect(result.overflow.length).toBeGreaterThan(0);
    expect(result.placed.length + result.overflow.length).toBe(labels.length);
    for (const label of result.placed) {
      bounded(label, bounds);
      expect(annotationOverlap(label, key)).toBe(false);
      for (const other of result.placed)
        if (other !== label) expect(annotationOverlap(label, other)).toBe(false);
    }
  });
});
