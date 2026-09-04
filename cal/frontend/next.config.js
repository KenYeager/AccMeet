/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow cross-origin requests to the FastAPI backend during development
  async rewrites() {
    return [];
  },
};

module.exports = nextConfig;
