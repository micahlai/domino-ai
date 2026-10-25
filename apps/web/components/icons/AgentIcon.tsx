import { Cpu, Rss, UserRound } from "lucide-react";
import { siClaude } from "simple-icons";
import { cn } from "../../lib/utils";
import { MarkTile } from "./ToolLogo";

// One mark per kind of actor in the activity log, so a Domino agent, a Claude agent, a CREAO
// agent and plain code never look alike. Domino uses the app's own mark (public/domino-logo.svg),
// Claude its official mark from Simple Icons, CREAO its favicon from creao.ai (public/logos/).

export type AgentKind = "domino" | "claude" | "creao" | "system" | "simulator" | "person";

export const AGENT_KIND_LABEL: Record<AgentKind, string> = {
  domino: "Domino agent",
  claude: "Claude agent",
  creao: "CREAO agent",
  system: "System",
  simulator: "Simulator",
  person: "Person",
};

/** Accent per kind, for rings and tints around the mark. CSS colors so themes can restyle. */
export const AGENT_TINT: Record<AgentKind, string> = {
  domino: "#3E9A7C",
  claude: `#${siClaude.hex}`,
  creao: "#111111",
  system: "hsl(var(--muted-foreground))",
  simulator: "hsl(var(--clay))",
  person: "hsl(var(--foreground))",
};

/** Domino's own mark: the white K from public/domino-logo.svg, drawn on the tile below. */
function DominoMark({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 40 40" width={size} height={size} aria-hidden="true">
      <g fill="#FFFFFF" transform="translate(20 20) scale(0.0688) translate(-1008.5 -554.5)">
        <rect x={834} y={420} width={102} height={258} />
        <rect
          x={-128.5}
          y={-45.5}
          width={257}
          height={91}
          transform="translate(1059.75 566.25) rotate(45)"
        />
      </g>
    </svg>
  );
}

export type AgentIconProps = {
  kind: AgentKind;
  size?: number;
  className?: string;
  /** Accessible name; omit when a visible label sits next to the icon. */
  title?: string;
};

export function AgentIcon({ kind, size = 28, className, title }: AgentIconProps) {
  if (kind === "claude")
    return (
      <MarkTile
        mark={{ kind: "path", path: siClaude.path, tile: "#F7EFE9", fg: `#${siClaude.hex}` }}
        size={size}
        className={className}
        title={title}
      />
    );
  if (kind === "creao")
    return (
      <MarkTile
        mark={{ kind: "image", src: "/logos/creao.png", tile: "#fff", scale: 1 }}
        size={size}
        className={className}
        title={title}
      />
    );
  if (kind === "domino")
    return (
      <span
        role={title ? "img" : undefined}
        aria-label={title}
        aria-hidden={title ? undefined : true}
        className={cn(
          "inline-grid shrink-0 place-items-center bg-[#0B0B0B] ring-1 ring-inset ring-white/[0.08]",
          className,
        )}
        style={{ width: size, height: size, borderRadius: Math.round(size * 0.26) }}
      >
        <DominoMark size={size} />
      </span>
    );
  const Icon = { system: Cpu, simulator: Rss, person: UserRound }[kind];
  const color = AGENT_TINT[kind];
  return (
    <span
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      className={cn("relative inline-grid shrink-0 place-items-center", className)}
      style={{ width: size, height: size, color, borderRadius: Math.round(size * 0.26) }}
    >
      <span
        aria-hidden="true"
        className="absolute inset-0 rounded-[inherit] border"
        style={{
          backgroundColor: `color-mix(in srgb, ${color} 10%, transparent)`,
          borderColor: `color-mix(in srgb, ${color} 22%, transparent)`,
        }}
      />
      <Icon
        aria-hidden="true"
        className="relative"
        style={{ width: size * 0.56, height: size * 0.56 }}
        strokeWidth={1.9}
      />
    </span>
  );
}
