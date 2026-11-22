import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 운영 이미지를 작게 만들기 위해 필요한 파일만 .next/standalone 에 모읍니다.
  output: "standalone",
};

export default nextConfig;
