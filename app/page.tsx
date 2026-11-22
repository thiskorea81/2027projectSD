export default function Home() {
  return (
    <main>
      <h1>학교 알림</h1>
      <p>Docker 개발 환경이 정상적으로 실행되었습니다.</p>
      <p>
        DB 연결 확인: <a href="/api/health">/api/health</a>
      </p>
    </main>
  );
}
