import type { NextConfig } from "next";
const config: NextConfig = {
  output: "standalone",
  // Mutable uploads, local credentials and private backups never belong in an image.
  outputFileTracingExcludes: {
    "/*": ["./.env*", "./.data/**/*", "./data/**/*", "./backups/**/*"],
  },
  poweredByHeader: false,
  devIndicators: false,
  images: { unoptimized: true },
  experimental: { serverActions: { bodySizeLimit: "12mb" } },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};
export default config;
