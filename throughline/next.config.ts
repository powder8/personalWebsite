import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite ships a wasm binary; keep it external so it isn't bundled.
  serverExternalPackages: ["@electric-sql/pglite"],
};

export default nextConfig;
