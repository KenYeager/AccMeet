import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow cross-origin requests to backend during development
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        // INTERNAL_API_URL is server-only (set in docker-compose) and points at the
        // backend container by service name; NEXT_PUBLIC_API_URL is the browser-facing
        // fallback for running the frontend outside Docker.
        destination: `${process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
