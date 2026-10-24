"use client";

import { TooltipProvider } from "@/components/ui/tooltip";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { type ReactNode, useState } from "react";
import { z } from "zod";

const deploymentUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  const [client] = useState(() =>
    deploymentUrl ? new ConvexReactClient(z.string().url().parse(deploymentUrl)) : null,
  );
  const content = <TooltipProvider>{children}</TooltipProvider>;
  // The P1 shell and fixture playground can be built before a deployment is selected.
  return client ? <ConvexProvider client={client}>{content}</ConvexProvider> : content;
}
