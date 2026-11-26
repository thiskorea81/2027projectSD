// 1단계 아이디 규칙: 아이디 = 이름. 같은 이름이 이미 있으면 등록 순서로 이름2, 이름3 …

// 한글은 입력 환경(맥/윈도)에 따라 자모가 분리된 형태(NFD)로 올 수 있어 NFC 로 맞추고, 공백은 모두 뺍니다.
export function normalizeName(raw: string): string {
  return raw.normalize("NFC").replace(/\s+/g, "");
}

export const normalizeLoginId = normalizeName;

// taken: 이미 쓰인 아이디(비활성 계정 포함). 반환한 아이디는 호출 쪽에서 taken 에 추가해야 합니다.
export function nextLoginId(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name)) return name;
  for (let n = 2; ; n++) {
    const candidate = `${name}${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}
