import { Database, Landmark } from "lucide-react";
import { siGusto, siHubspot, siQuickbooks, siStripe } from "simple-icons";
import { cn } from "../../lib/utils";
import { VENDORS, type VendorId, vendorFor } from "./vendors";

// Official marks for the vendors Domino reads from. Marks that Simple Icons ships (CC0, taken from
// each brand's own guidelines) are drawn from its SVG path in white on the brand color. The rest
// are the vendor's own favicon or logo file, downloaded from its website into public/logos/.
// Sources are listed in README.md.

/** A Simple Icons path (24 x 24 viewBox), drawn in `fg` on a `tile` background. */
type PathMark = { kind: "path"; path: string; tile: string; fg: string };
/** A logo file in public/logos/, drawn at `scale` of the tile on a `tile` background. */
type ImageMark = { kind: "image"; src: string; tile: string; scale: number };
export type Mark = PathMark | ImageMark;

const hex = (h: string) => `#${h}`;

export const MARKS: Record<Exclude<VendorId, "bank" | "generic">, Mark> = {
  stripe: { kind: "path", path: siStripe.path, tile: hex(siStripe.hex), fg: "#fff" },
  hubspot: { kind: "path", path: siHubspot.path, tile: hex(siHubspot.hex), fg: "#fff" },
  qbo: { kind: "path", path: siQuickbooks.path, tile: hex(siQuickbooks.hex), fg: "#fff" },
  gusto: { kind: "path", path: siGusto.path, tile: hex(siGusto.hex), fg: "#fff" },
  // Round app icons: the tile takes the icon's own background so it reads as one square.
  ramp: { kind: "image", src: "/logos/ramp.png", tile: "#E4F222", scale: 1 },
  plaid: { kind: "image", src: "/logos/plaid.png", tile: "#00282F", scale: 1 },
  capitalone: { kind: "image", src: "/logos/capitalone.svg", tile: "#fff", scale: 0.78 },
  apify: { kind: "image", src: "/logos/apify.svg", tile: "#fff", scale: 0.62 },
  crs: { kind: "image", src: "/logos/crs.svg", tile: "#fff", scale: 1 },
};

export type ToolLogoProps = {
  /** A VendorId, or any alias the app uses ("cards", "nessie", "QuickBooks", "apify"). */
  vendor: VendorId | string;
  /** Pixel size of the square tile. */
  size?: number;
  className?: string;
  /** Accessible name; omit when a visible label sits next to the logo. */
  title?: string;
};

/** A square tile with a brand mark: a Simple Icons path or a downloaded logo file. */
export function MarkTile({
  mark,
  size,
  className,
  title,
}: {
  mark: Mark;
  size: number;
  className?: string;
  title?: string;
}) {
  const radius = Math.round(size * 0.26);
  return (
    <span
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      className={cn(
        "relative inline-grid shrink-0 place-items-center overflow-hidden ring-1 ring-inset ring-black/[0.08]",
        className,
      )}
      style={{ width: size, height: size, borderRadius: radius, backgroundColor: mark.tile }}
    >
      {mark.kind === "path" ? (
        <svg
          viewBox="0 0 24 24"
          width={Math.round(size * 0.58)}
          height={Math.round(size * 0.58)}
          aria-hidden="true"
        >
          <path d={mark.path} fill={mark.fg} />
        </svg>
      ) : (
        <img
          src={mark.src}
          alt=""
          width={Math.round(size * mark.scale)}
          height={Math.round(size * mark.scale)}
          draggable={false}
          className="object-contain"
        />
      )}
    </span>
  );
}

/** Brand tile for a data source or vendor. Unknown ids get a neutral database tile. */
export function ToolLogo({ vendor, size = 28, className, title }: ToolLogoProps) {
  const id = vendor in VENDORS ? (vendor as VendorId) : vendorFor(vendor);
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
        style={{ width: size, height: size, borderRadius: Math.round(size * 0.26) }}
      >
        <Icon style={{ width: size * 0.55, height: size * 0.55 }} strokeWidth={1.75} />
      </span>
    );
  }
  return <MarkTile mark={MARKS[id]} size={size} className={className} title={title} />;
}
