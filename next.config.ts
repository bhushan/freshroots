import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Every page reads the session cookie and live database results, so nothing is cached or prerendered.
  cacheComponents: false,
  partialPrefetching: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
