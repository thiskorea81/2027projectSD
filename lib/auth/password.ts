// 비밀번호 해시 (argon2id). Next 앱과 관리 스크립트(node scripts/…)가 함께 씁니다.
import { hash, verify } from "@node-rs/argon2";

// OWASP 권장 최소값 수준 (메모리 19MiB, 반복 2). 맥미니에서 1회 수십 ms.
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const PASSWORD_MIN_LENGTH = Number(process.env.PASSWORD_MIN_LENGTH ?? "8");

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, OPTIONS);
}

export async function verifyPassword(stored: string | null, plain: string): Promise<boolean> {
  if (!stored) return false;
  try {
    return await verify(stored, plain);
  } catch {
    return false;
  }
}

// 없는 아이디로 로그인할 때도 같은 시간이 걸리게 해서, 응답 시간으로 계정 존재 여부를 알 수 없게 합니다.
let dummyHash: Promise<string> | undefined;
export async function burnVerifyTime(plain: string): Promise<void> {
  dummyHash ??= hashPassword("dummy-password-for-timing");
  await verifyPassword(await dummyHash, plain);
}

// 새 계정·비밀번호 초기화 때 쓰는 초기 비밀번호. 저장소에 두지 않고 .env 의 INITIAL_PASSWORD 로만 받습니다.
export function initialPassword(): string {
  const value = process.env.INITIAL_PASSWORD ?? "";
  if (!value) {
    throw new Error(
      "INITIAL_PASSWORD 가 설정되지 않았습니다. .env 에 초기 비밀번호를 넣은 뒤 컨테이너를 다시 시작하세요.",
    );
  }
  return value;
}

export function checkNewPassword(next: string, current: string): string | null {
  if (next.length < PASSWORD_MIN_LENGTH) return `새 비밀번호는 ${PASSWORD_MIN_LENGTH}자 이상이어야 합니다.`;
  if (next === current) return "현재 비밀번호와 다른 비밀번호를 쓰세요.";
  if (process.env.INITIAL_PASSWORD && next === process.env.INITIAL_PASSWORD) {
    return "초기 비밀번호는 쓸 수 없습니다.";
  }
  return null;
}
