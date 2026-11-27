import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "학교 알림",
  description: "학교 메신저를 대체하는 교사용 알림·할 일 관리",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
