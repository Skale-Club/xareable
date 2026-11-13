/** @type {import('next').NextConfig} */
const nextConfig = {
  // Required for the small, self-contained Docker image used on the shared
  // Coolify host (see Dockerfile + MIGRATION-PLAYBOOK disk discipline).
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
};

export default nextConfig;
