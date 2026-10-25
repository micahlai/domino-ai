/**
 * Small "verb + object" links between pages. Pure, so the routing rules are testable. Every
 * target is an existing route or an id already on the page.
 */

/** The brain map opens with this node's panel. */
export const mapNodeHref = (nodeId: string) =>
  `/field/map?${new URLSearchParams({ node: nodeId })}`;

/** Record ids carry their source's prefix (card_1 is a Ramp charge). */
const RECORD_SOURCE: [RegExp, string][] = [
  [/^card_/, "cards"],
  [/^pay_/, "payroll"],
  [/^inv_/, "billing"],
  [/^bill_/, "books"],
  [/^bank_/, "bank"],
  [/^deal_/, "crm"],
];

/** The data source node a flagged record came from, or null when the id is not a record. */
export function recordSourceNode(ref: string): string | null {
  const hit = RECORD_SOURCE.find(([re]) => re.test(ref));
  return hit ? `source:${hit[1]}` : null;
}

/** Map the ?node= value to a node that exists: an exact id, else an agent or source by name. */
export function resolveMapNode(param: string | null, ids: readonly string[]): string | null {
  if (!param) return null;
  const want = param.trim().toLowerCase();
  const exact = ids.find((id) => id.toLowerCase() === want);
  if (exact) return exact;
  const named = [`agent:${want}`, `source:${want}`, `output:${want}`];
  return ids.find((id) => named.includes(id.toLowerCase())) ?? null;
}

export type ResultLink = { label: string; href: string };

/** Pages a brain map node produced work on. Agents by role, outputs by id. */
export function nodeResults(node: { id: string; role?: string }): ResultLink[] {
  const key = (node.role ?? node.id.replace(/^(agent|output):/, "")).toLowerCase();
  if (node.id.startsWith("output:")) {
    if (key === "flags") return [{ label: "See flags", href: "/field#flags-title" }];
    if (key === "forecast") return [{ label: "See forecast", href: "/" }];
    if (key === "books") return [{ label: "See dashboard", href: "/" }];
    return [];
  }
  if (!node.id.startsWith("agent:")) return [];
  if (key.startsWith("audit")) return [{ label: "See flags", href: "/field#flags-title" }];
  if (key.startsWith("forecaster")) return [{ label: "See risks", href: "/field#risks-title" }];
  if (key.startsWith("advisor"))
    return [{ label: "See suggestions", href: "/field#suggestions-title" }];
  if (key.startsWith("analyst"))
    return [
      { label: "See suggestions", href: "/field#suggestions-title" },
      { label: "See risks", href: "/field#risks-title" },
    ];
  if (key.startsWith("ingestion")) return [{ label: "See dashboard", href: "/" }];
  return [];
}
