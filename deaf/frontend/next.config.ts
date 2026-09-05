import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        // INTERNAL_API_URL is server-only (docker); NEXT_PUBLIC_API_URL is browser-facing fallback
        destination: `${process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8003"}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
