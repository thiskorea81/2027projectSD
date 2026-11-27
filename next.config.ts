import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 운영 이미지를 작게 만들기 위해 필요한 파일만 .next/standalone 에 모읍니다.
  output: "standalone",
  // 개발 서버가 AGENTS.md 를 저장소에 만들지 않게 합니다.
  agentRules: false,
  experimental: {
    // 관리자 화면의 명렬표(hwpx) 업로드용. 그림이 든 hwpx 도 받을 수 있게 여유를 둡니다.
    serverActions: { bodySizeLimit: "5mb" },
  },
};

export default nextConfig;
