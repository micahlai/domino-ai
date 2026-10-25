// Named/default/re-exports, dynamic import(), and bare side-effect `import "x"`.
const IMPORT =
  /(?:import|export)\s[^'"]*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|(?:^|[;\n])\s*import\s*["']([^"']+)["']/g;

export function importSpecs(text) {
  return [...text.matchAll(IMPORT)].map((m) => ({ spec: m[1] ?? m[2] ?? m[3], index: m.index }));
}
