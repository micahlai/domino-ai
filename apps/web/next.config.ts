import type { NextConfig } from "next";

// Older Field URLs point at the pages that replaced them, so saved links never 404.
const FIELD_REDIRECTS: [string, string][] = [
  ["/connect", "/field/connect"],
  ["/c/:companyId/connect", "/field/connect"],
  ["/dashboard", "/"],
  ["/worker", "/field"],
  ["/field/review", "/field"],
  ["/map", "/field/map"],
  ["/brain-map", "/field/map"],
  ["/field/brain-map", "/field/map"],
];

const config: NextConfig = {
  transpilePackages: ["@domino/contracts"],
  async redirects() {
    return FIELD_REDIRECTS.map(([source, destination]) => ({
      source,
      destination,
      permanent: false,
    }));
  },
};

export default config;
