import type { NextConfig } from "next";

const UPSTREAM = "https://api.jup.ag/prediction/v1";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      { source: "/api/prediction/:path*", destination: `${UPSTREAM}/:path*` },
    ];
  },
};

export default nextConfig;
