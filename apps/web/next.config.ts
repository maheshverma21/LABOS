import { join } from "node:path";
import type { NextConfig } from "next";

// Where the Express API runs. The browser never calls it directly: requests to
// /api/* on the web app are proxied there, so the refresh-token cookie stays first-party.
// Read at build time, so the Docker build passes it in (see deploy/).
const API_URL = process.env.API_URL ?? "http://localhost:4000";

const nextConfig: NextConfig = {
  // The shared package ships TypeScript source.
  transpilePackages: ["@lms/shared"],
  // Docker builds a self-contained server (deploy/Dockerfile.web); local `next start` doesn't need it.
  ...(process.env.NEXT_STANDALONE === "1" ? { output: "standalone", outputFileTracingRoot: join(__dirname, "../..") } : {}),
  poweredByHeader: false,
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_URL}/api/:path*` }];
  },
};

export default nextConfig;
