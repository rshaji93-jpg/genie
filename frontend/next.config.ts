import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  allowedDevOrigins: [
    "*.trycloudflare.com",
    "urge-images-sensor-convinced.trycloudflare.com",
  ],
};

export default nextConfig;