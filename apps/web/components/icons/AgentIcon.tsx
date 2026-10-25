import { Blocks, Cpu, Rss, UserRound } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

// One glyph per kind of actor in the activity log, on a soft tint of its own color, so a Domino
// agent, a Claude agent, a CREAO agent and plain code never look alike.

export type AgentKind = "domino" | "claude" | "creao" | "system" | "simulator" | "person";

export const AGENT_KIND_LABEL: Record<AgentKind, string> = {
  domino: "Domino agent",
  claude: "Claude agent",
  creao: "CREAO agent",
  system: "System",
  simulator: "Simulator",
  person: "Person",
};

/** Glyph color; the tile is the same color at low opacity. CSS colors so themes can restyle. */
const TINT: Record<AgentKind, string> = {
  domino: "hsl(var(--primary-ink))",
  claude: "#C96442",
  creao: "#5B5BD6",
  system: "hsl(var(--muted-foreground))",
  simulator: "hsl(var(--clay))",
  person: "hsl(var(--foreground))",
};

/** A domino tile: Domino's own agents. */
function DominoGlyph({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" aria-hidden="true">
      <rect x={7} y={2.5} width={10} height={19} rx={2.6} stroke="currentColor" strokeWidth={1.8} />
      <path d="M8.5 12h7" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
      <circle cx={12} cy={7.2} r={1.35} fill="currentColor" />
      <circle cx={10.1} cy={15.4} r={1.2} fill="currentColor" />
      <circle cx={13.9} cy={18.2} r={1.2} fill="currentColor" />
    </svg>
  );
}

/** A radial spark, the shape people know as Claude's mark (simplified, not the logo file). */
function ClaudeGlyph({ size }: { size: number }) {
  const rays = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <g stroke="currentColor" strokeLinecap="round" transform="translate(12 12)">
        {rays.map((deg, i) => (
          <line
            key={deg}
            x1={0}
            y1={-2.2}
            x2={0}
            y2={i % 2 === 0 ? -9.5 : -7}
            strokeWidth={i % 2 === 0 ? 2.1 : 1.8}
            transform={`rotate(${deg})`}
          />
        ))}
      </g>
    </svg>
  );
}

function glyph(kind: AgentKind, size: number): ReactNode {
  const s = Math.round(size * 0.6);
  if (kind === "domino") return <DominoGlyph size={s} />;
  if (kind === "claude") return <ClaudeGlyph size={s} />;
  const Icon = { creao: Blocks, system: Cpu, simulator: Rss, person: UserRound }[kind];
  return <Icon aria-hidden="true" style={{ width: s, height: s }} strokeWidth={1.9} />;
}

export type AgentIconProps = {
  kind: AgentKind;
  size?: number;
  className?: string;
  /** Accessible name; omit when a visible label sits next to the icon. */
  title?: string;
};

export function AgentIcon({ kind, size = 28, className, title }: AgentIconProps) {
  const color = TINT[kind];
  return (
    <span
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      className={cn("relative inline-grid shrink-0 place-items-center", className)}
      style={{ width: size, height: size, color, borderRadius: Math.round(size * 0.3) }}
    >
      <span
        aria-hidden="true"
        className="absolute inset-0 rounded-[inherit] border"
        style={{
          backgroundColor: `color-mix(in srgb, ${color} 10%, transparent)`,
          borderColor: `color-mix(in srgb, ${color} 22%, transparent)`,
        }}
      />
      <span className="relative">{glyph(kind, size)}</span>
    </span>
  );
}
