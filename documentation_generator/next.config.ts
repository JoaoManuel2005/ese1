import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  // Enable standalone output for Docker deployment
  output: "standalone",
  // Fix workspace root detection warning (multiple lockfiles)
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
