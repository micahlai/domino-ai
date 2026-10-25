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

/** Domino's own mark: the same two tiles as public/domino-logo.svg. */
function DominoMark({ size }: { size: number }) {
  return (
    <svg viewBox="0 0 40 40" width={size} height={size} aria-hidden="true">
      <rect
        x={4}
        y={3}
        width={15}
        height={32}
        rx={4}
        fill="#68B99E"
        transform="rotate(-12 12 20)"
      />
      <rect x={23} y={8} width={13} height={28} rx={4} fill="#BA8768" />
      <circle cx={11} cy={12} r={2} fill="#202B27" />
      <circle cx={29} cy={27} r={2} fill="#202B27" />
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
          "inline-grid shrink-0 place-items-center bg-[#F1F6F3] ring-1 ring-inset ring-black/[0.08]",
          className,
        )}
        style={{ width: size, height: size, borderRadius: Math.round(size * 0.26) }}
      >
        <DominoMark size={Math.round(size * 0.78)} />
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
