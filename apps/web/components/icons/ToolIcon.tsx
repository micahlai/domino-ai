import {
  ArrowDownToLine,
  ArrowRightLeft,
  Database,
  FlaskConical,
  Plug,
  ScanSearch,
  TrendingUp,
  Upload,
  Wrench,
} from "lucide-react";
import { cn } from "../../lib/utils";

// One lucide glyph per kind of tool call, so a row of tools reads at a glance: reads point down
// into Domino, saves are a database, checks are a magnifier, and so on.

export type ToolCategory =
  | "read"
  | "map"
  | "save"
  | "audit"
  | "forecast"
  | "export"
  | "simulate"
  | "connect"
  | "other";

export const TOOL_CATEGORY_LABEL: Record<ToolCategory, string> = {
  read: "Read data",
  map: "Transform",
  save: "Save",
  audit: "Check",
  forecast: "Compute",
  export: "Export",
  simulate: "Simulate",
  connect: "Connect",
  other: "Tool",
};

const ICON = {
  read: ArrowDownToLine,
  map: ArrowRightLeft,
  save: Database,
  audit: ScanSearch,
  forecast: TrendingUp,
  export: Upload,
  simulate: FlaskConical,
  connect: Plug,
  other: Wrench,
} satisfies Record<ToolCategory, unknown>;

export type ToolIconProps = {
  category: ToolCategory;
  size?: number;
  className?: string;
  /** Wrap the glyph in a hairline tile (for cards); bare glyph otherwise (for chips). */
  tile?: boolean;
};

export function ToolIcon({ category, size = 14, className, tile }: ToolIconProps) {
  const Icon = ICON[category];
  if (!tile)
    return (
      <Icon
        aria-hidden="true"
        className={cn("shrink-0", className)}
        style={{ width: size, height: size }}
        strokeWidth={1.9}
      />
    );
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-grid shrink-0 place-items-center border bg-background text-foreground",
        className,
      )}
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.28) }}
    >
      <Icon style={{ width: size * 0.5, height: size * 0.5 }} strokeWidth={1.9} />
    </span>
  );
}
