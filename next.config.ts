import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Enforce single CPU core usage during build as requested
  cpus: 1,
  reactStrictMode: true,
};

export default nextConfig;

