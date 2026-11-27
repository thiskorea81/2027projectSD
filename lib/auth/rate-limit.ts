// 접속 주소(IP)별 로그인 실패 제한: 10분에 20번 넘게 틀리면 잠시 막습니다.
// (계정별 5회 잠금과 별개. 서버 한 대라 메모리로 충분합니다.)
const WINDOW_MS = 10 * 60 * 1000;
const LIMIT = 20;
const failures = new Map<string, { count: number; resetAt: number }>();

export function isIpBlocked(ip: string | null): boolean {
  if (!ip) return false;
  const f = failures.get(ip);
  if (!f || f.resetAt < Date.now()) return false;
  return f.count >= LIMIT;
}

export function recordIpFailure(ip: string | null) {
  if (!ip) return;
  const now = Date.now();
  const f = failures.get(ip);
  if (!f || f.resetAt < now) failures.set(ip, { count: 1, resetAt: now + WINDOW_MS });
  else f.count++;
  if (failures.size > 5000) for (const [k, v] of failures) if (v.resetAt < now) failures.delete(k);
}
