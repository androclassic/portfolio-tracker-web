import type { NextConfig } from "next";
import { execSync } from 'child_process';

const gitVersion = process.env.NEXT_PUBLIC_APP_VERSION || (() => {
  try {
    return execSync('git describe --tags --always').toString().trim();
  } catch {
    return 'dev';
  }
})();

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: gitVersion,
  },
};

export default nextConfig;
