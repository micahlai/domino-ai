import { Database, Landmark } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/utils";
import { VENDORS, type VendorId, vendorFor } from "./vendors";

// Simplified marks for the vendors Domino reads from: a brand-colored tile with the vendor's
// letterform or a reduced version of its mark. Hand drawn (no icon dependency), so they stay crisp
// at 16 to 40 px. They identify a source; they are not official logo files.

const LETTER = {
  x: 16,
  y: 16.5,
  textAnchor: "middle",
  dominantBaseline: "central",
  fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
  fontWeight: 700,
} as const;

const GLYPH: Record<Exclude<VendorId, "bank" | "generic">, ReactNode> = {
  stripe: (
    <text {...LETTER} fontSize={19} fill="#fff">
      S
    </text>
  ),
  ramp: (
    <text {...LETTER} fontSize={19} fill="#111" letterSpacing={-0.5}>
      r
    </text>
  ),
  qbo: (
    <>
      <circle cx={16} cy={16} r={10.5} fill="none" stroke="#fff" strokeWidth={1.6} />
      <text {...LETTER} y={15.6} fontSize={11.5} fill="#fff" letterSpacing={-0.4}>
        qb
      </text>
    </>
  ),
  gusto: (
    <text {...LETTER} y={14.6} fontSize={20} fill="#fff">
      g
    </text>
  ),
  hubspot: (
    <g fill="#fff" stroke="#fff" strokeLinecap="round">
      <circle cx={17.5} cy={19} r={4.6} fill="none" strokeWidth={2.4} />
      <path d="M17.5 14.2V9.6" strokeWidth={2.2} />
      <circle cx={17.5} cy={8.4} r={2.3} stroke="none" />
      <path d="M13.6 16.2 9.8 13.4" strokeWidth={1.8} />
      <circle cx={8.9} cy={12.7} r={1.7} stroke="none" />
      <path d="M14.2 22.4 11.4 25" strokeWidth={1.8} />
      <circle cx={10.6} cy={25.8} r={1.5} stroke="none" />
    </g>
  ),
  plaid: (
    <g transform="rotate(45 16 16)" fill="#fff">
      {[0, 1, 2].flatMap((r) =>
        [0, 1, 2].map((c) =>
          (r + c) % 2 === 0 ? (
            <rect
              key={`${r}${c}`}
              x={9.4 + c * 4.6}
              y={9.4 + r * 4.6}
              width={3.8}
              height={3.8}
              rx={0.6}
            />
          ) : null,
        ),
      )}
    </g>
  ),
  capitalone: (
    <>
      <path
        d="M6 21.5C10.5 12.5 19 8.6 27 10.6"
        fill="none"
        stroke="#E5463B"
        strokeWidth={3.2}
        strokeLinecap="round"
      />
      <text {...LETTER} x={18} y={21} fontSize={10} fill="#fff" fontWeight={600}>
        1
      </text>
    </>
  ),
};

export type ToolLogoProps = {
  /** A VendorId, or any alias the app uses ("cards", "nessie", "QuickBooks"). */
  vendor: VendorId | string;
  /** Pixel size of the square tile. */
  size?: number;
  className?: string;
  /** Accessible name; omit when a visible label sits next to the logo. */
  title?: string;
};

/** Brand tile for a data source or vendor. Unknown ids get a neutral database tile. */
export function ToolLogo({ vendor, size = 28, className, title }: ToolLogoProps) {
  const id = vendor in VENDORS ? (vendor as VendorId) : vendorFor(vendor);
  const meta = VENDORS[id];
  const radius = Math.round(size * 0.26);
  if (id === "bank" || id === "generic") {
    const Icon = id === "bank" ? Landmark : Database;
    return (
      <span
        role={title ? "img" : undefined}
        aria-label={title}
        aria-hidden={title ? undefined : true}
        className={cn(
          "inline-grid shrink-0 place-items-center border bg-muted text-muted-foreground",
          className,
        )}
        style={{ width: size, height: size, borderRadius: radius }}
      >
        <Icon style={{ width: size * 0.55, height: size * 0.55 }} strokeWidth={1.75} />
      </span>
    );
  }
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      className={cn("shrink-0", className)}
    >
      <rect width={32} height={32} rx={(radius / size) * 32} fill={meta.color} />
      <rect
        x={0.5}
        y={0.5}
        width={31}
        height={31}
        rx={(radius / size) * 32 - 0.5}
        fill="none"
        stroke="#000"
        strokeOpacity={0.08}
      />
      {GLYPH[id]}
    </svg>
  );
}
