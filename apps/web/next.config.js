const path = require("path");

const monorepoRoot = path.resolve(__dirname, "../../");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@careloop/contracts"],
  experimental: {
    outputFileTracingRoot: monorepoRoot,
    serverComponentsExternalPackages: ["pg", "bcryptjs"],
  },
  webpack: (config, { isServer }) => {
    config.resolve.modules = [
      path.join(monorepoRoot, "node_modules"),
      ...(config.resolve.modules || ["node_modules"]),
    ];
    if (isServer) {
      config.externals = [...(config.externals || []), "pg", "bcryptjs"];
    }
    return config;
  },
};

module.exports = nextConfig;
