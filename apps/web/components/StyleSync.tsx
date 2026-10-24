"use client";

import { syncStyleFromSearch } from "@/lib/style";
import { useSearchParams } from "next/navigation";
import { useEffect } from "react";

/** Keeps <html data-style> in step with ?style= across Next client navigation and back/forward.
 * Renders nothing, so it cannot remount page state. useSearchParams needs a Suspense boundary
 * (AppShell provides it) so static pages still prerender. */
export function StyleSync() {
  const search = useSearchParams().toString();
  useEffect(() => syncStyleFromSearch(search), [search]);
  return null;
}
