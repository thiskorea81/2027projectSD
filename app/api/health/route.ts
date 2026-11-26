import { pool } from "@/lib/db";
import { aiStatus } from "@/lib/ai";

export const dynamic = "force-dynamic";

// 컨테이너 상태 확인용: GET /api/health
// DB 는 필수, AI 는 모델을 아직 안 받았어도 앱은 동작하므로 참고 정보로만 보여 줍니다.
export async function GET() {
  const result: Record<string, unknown> = {};
  let ok = true;

  try {
    const { rows } = await pool.query("select now() as now");
    result.db = { status: "ok", time: rows[0].now };
  } catch (err) {
    ok = false;
    result.db = { status: "error", message: String(err) };
  }

  try {
    result.ai = { status: "ok", ...(await aiStatus()) };
  } catch (err) {
    result.ai = { status: "unreachable", message: String(err) };
  }

  return Response.json({ status: ok ? "ok" : "error", ...result }, { status: ok ? 200 : 503 });
}
