import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source; Next compiles them.
  transpilePackages: ["@dockclock/core", "@dockclock/paypal", "@dockclock/agents", "@dockclock/db"],
  serverExternalPackages: ["@prisma/client"],
};

export default nextConfig;
