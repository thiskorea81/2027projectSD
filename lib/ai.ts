// 로컬 AI 서버(Ollama) 호출 도우미. 외부 AI API 는 사용하지 않습니다.
const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://host.docker.internal:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "gemma3:12b";

export async function aiStatus() {
  const res = await fetch(`${OLLAMA_URL}/api/tags`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Ollama 응답 오류: ${res.status}`);
  const data = (await res.json()) as { models?: { name: string }[] };
  const models = (data.models ?? []).map((m) => m.name);
  return { model: OLLAMA_MODEL, modelReady: models.includes(OLLAMA_MODEL), models };
}

// 한 번에 답을 받는 간단한 생성 함수 (예: 메시지 요약, 대상자 분류)
export async function generate(prompt: string, model = OLLAMA_MODEL) {
  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt, stream: false }),
  });
  if (!res.ok) throw new Error(`Ollama 응답 오류: ${res.status}`);
  const data = (await res.json()) as { response: string };
  return data.response;
}
