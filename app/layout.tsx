import type { ReactNode } from "react";

export const metadata = {
  title: "학교 알림",
  description: "학교 메신저를 대체하는 교사용 알림·할 일 관리",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, padding: 24 }}>
        {children}
      </body>
    </html>
  );
}
