// 야간 작업 워커 (뼈대)
// 업무시간 외(WORKER_ACTIVE_FROM ~ WORKER_ACTIVE_UNTIL)에만 부서 공문 폴더의 새 문서를 처리합니다.
// 실제 처리(업무 분류, 담당자 지정, 자동화)는 processDocuments() 안에 구현합니다.
// Node 22 의 TypeScript 타입 제거 기능으로 바로 실행됩니다: node worker/index.ts
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

const DOCUMENTS_DIR = process.env.DOCUMENTS_DIR ?? "/data/documents";
const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://host.docker.internal:11434";
const ACTIVE_FROM = process.env.WORKER_ACTIVE_FROM ?? "18:00";
const ACTIVE_UNTIL = process.env.WORKER_ACTIVE_UNTIL ?? "08:00";
const INTERVAL_MIN = Number(process.env.WORKER_INTERVAL_MINUTES ?? "10");
const CLEANUP_DAY = Number(process.env.CLEANUP_DAY_OF_MONTH ?? "1");
const CLEANUP_DRY_RUN = (process.env.CLEANUP_DRY_RUN ?? "true") !== "false";
const STATE_FILE = join(DOCUMENTS_DIR, ".worker-state.json");

const log = (...args: unknown[]) =>
  console.log(`[worker] ${new Date().toLocaleString("sv-SE", { timeZone: "Asia/Seoul" })}`, ...args);

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

// 현재 시각(서울)이 활성 시간대인지. 18:00~08:00 처럼 자정을 넘기는 구간도 처리합니다.
export function isActiveTime(now = new Date()): boolean {
  const seoul = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  const cur = seoul.getHours() * 60 + seoul.getMinutes();
  const from = toMinutes(ACTIVE_FROM);
  const until = toMinutes(ACTIVE_UNTIL);
  return from <= until ? cur >= from && cur < until : cur >= from || cur < until;
}

async function ollamaReady(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`);
    return res.ok;
  } catch {
    return false;
  }
}

// 부서 폴더별 파일 수를 세는 자리. 여기서 새 문서를 찾아 로컬 AI 로 처리하도록 확장합니다.
async function processDocuments() {
  let departments: string[] = [];
  try {
    departments = (await readdir(DOCUMENTS_DIR, { withFileTypes: true }))
      .filter((d) => d.isDirectory() && !d.name.startsWith("."))
      .map((d) => d.name);
  } catch (err) {
    log(`부서 공문 폴더를 읽을 수 없습니다: ${DOCUMENTS_DIR}`, String(err));
    return;
  }
  for (const dept of departments) {
    const files = await readdir(join(DOCUMENTS_DIR, dept));
    let count = 0;
    for (const f of files) {
      if (!f.startsWith(".") && (await stat(join(DOCUMENTS_DIR, dept, f))).isFile()) count++;
    }
    log(`부서 "${dept}": 문서 ${count}개`);
    // TODO: 아직 처리하지 않은 문서 → 텍스트 추출 → 로컬 LLM 으로 분류·담당자 추천 → DB 기록
  }
}

// 월 1회 정리: 기한이 지났거나 처리가 끝난 불필요한 자료를 삭제하는 자리.
// 기한이 남은 미처리 업무의 자료는 남깁니다. 세부 규칙(무엇을 지울지)은 DB 설계에 따라 구현합니다.
// CLEANUP_DRY_RUN=true(기본)이면 실제로 지우지 않고 지울 대상만 기록합니다.
// 지운 파일도 NAS 의 documents-deleted/, uploads-deleted/ 에 NAS_BACKUP_KEEP_DAYS 동안 남습니다.
async function monthlyCleanup() {
  const seoul = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" }));
  const month = `${seoul.getFullYear()}-${String(seoul.getMonth() + 1).padStart(2, "0")}`;
  if (seoul.getDate() < CLEANUP_DAY) return;

  let state: { lastCleanupMonth?: string } = {};
  try {
    state = JSON.parse(await readFile(STATE_FILE, "utf8"));
  } catch {
    // 상태 파일이 없으면 처음 실행
  }
  if (state.lastCleanupMonth === month) return;

  log(`월간 정리 시작 (${month}${CLEANUP_DRY_RUN ? ", 시험 모드: 실제 삭제 안 함" : ""})`);
  // TODO: DB 에서 '삭제 대상'(처리 완료·기한 경과·보관 기간 지남) 문서/첨부파일 목록을 조회해 삭제하고 DB 기록 정리
  log("월간 정리 끝");

  state.lastCleanupMonth = month;
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2));
}

async function tick() {
  if (!isActiveTime()) return;
  await monthlyCleanup().catch((err) => log("월간 정리 중 오류", err));
  if (!(await ollamaReady())) {
    log(`로컬 AI(Ollama)에 연결할 수 없어 이번 회차는 건너뜁니다: ${OLLAMA_URL}`);
    return;
  }
  log("공문 처리 시작");
  await processDocuments();
  log("공문 처리 끝");
}

log(`시작: 활성 시간 ${ACTIVE_FROM}~${ACTIVE_UNTIL} (서울), ${INTERVAL_MIN}분 간격, 폴더 ${DOCUMENTS_DIR}`);
log(`현재 ${isActiveTime() ? "활성 시간대입니다" : "업무 시간이라 대기합니다"}`);
await tick();
setInterval(() => {
  tick().catch((err) => log("처리 중 오류", err));
}, INTERVAL_MIN * 60 * 1000);
