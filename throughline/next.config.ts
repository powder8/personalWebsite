import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep heavy/native-ish server deps external rather than bundled.
  serverExternalPackages: ["@electric-sql/pglite", "exceljs"],
};

export default nextConfig;
