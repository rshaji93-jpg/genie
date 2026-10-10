import type { NextConfig } from "next";

const isDevelopment = process.env.NODE_ENV !== "production";

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: true,
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
          destination: "http://127.0.0.1:8000/api/tickets",
        },
        {
          source: "/api/py/ws/:path*",
          destination: "http://127.0.0.1:8000/ws/:path*",
        },
        {
          source: "/api/py/api/:path*",
          destination: "http://127.0.0.1:8000/api/:path*",
        },
        {
          source: "/api/py/:path*",
          destination: "http://127.0.0.1:8000/api/:path*",
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