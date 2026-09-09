import type { NextConfig } from "next";

const config: NextConfig = {
  // node:sqlite is a server-only builtin. Nothing that touches the database may
  // be bundled for the client.
  serverExternalPackages: ["node:sqlite"],
  typedRoutes: true,
  // The home directory contains a stray package-lock.json; without this
  // Turbopack walks up and adopts it as the workspace root.
  turbopack: { root: import.meta.dirname },
  // The real workbook is 1.01 MB; a server action's default body limit is 1 MB,
  // and the upload is a server action so the validation report can precede the
  // commit without a second round trip.
  experimental: { serverActions: { bodySizeLimit: "25mb" } },
  poweredByHeader: false,
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "same-origin" },
        { key: "X-Frame-Options", value: "DENY" },
      ],
    }];
  },
};

export default config;
