import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pg はサーバー側でのみ使い、バンドルしない
  serverExternalPackages: ["pg"],
};

export default nextConfig;
