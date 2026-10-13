import type { NextConfig } from "next";

const isDevelopment = process.env.NODE_ENV !== "production";
const backendUrl = (
  process.env.NEXT_PUBLIC_BACKEND_URL || "http://127.0.0.1:8000"
).replace(/\/+$/, "");

const nextConfig: NextConfig = {
  images: {
    unoptimized: true,
    remotePatterns: [
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
      { protocol: "https", hostname: "platform-lookaside.fbsbx.com" },
      { protocol: "https", hostname: "graph.facebook.com" },
    ],
  },
  allowedDevOrigins: [
    "*.trycloudflare.com",
    "personalaigenie.eu.org",
  ],
  async rewrites() {
    return {
      beforeFiles: [
        ...(isDevelopment
          ? [{ source: "/sw.js", destination: "/404" }]
          : []),
        {
          source: "/api/py/tickets",
          destination: `${backendUrl}/api/tickets`,
        },
        {
          source: "/api/py/ws/:path*",
          destination: `${backendUrl}/ws/:path*`,
        },
        {
          source: "/api/py/api/:path*",
          destination: `${backendUrl}/api/:path*`,
        },
        {
          source: "/api/py/:path*",
          destination: `${backendUrl}/api/:path*`,
        },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
  async headers() {
    return isDevelopment
      ? [
          {
            source: "/sw.js",
            headers: [
              {
                key: "Cache-Control",
                value: "no-store, no-cache, must-revalidate",
              },
            ],
          },
        ]
      : [];
  },
};

export default nextConfig;