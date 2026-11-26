"use client";

import { useActionState } from "react";
import { changePasswordAction, type ChangeState } from "./actions";

export function ChangePasswordForm({ minLength }: { minLength: number }) {
  const [state, action, pending] = useActionState<ChangeState, FormData>(changePasswordAction, {});
  return (
    <form action={action}>
      <label htmlFor="current">현재 비밀번호</label>
      <input id="current" name="current" type="password" autoComplete="current-password" required />
      <label htmlFor="next">새 비밀번호 ({minLength}자 이상)</label>
      <input id="next" name="next" type="password" autoComplete="new-password" minLength={minLength} required />
      <label htmlFor="confirm">새 비밀번호 확인</label>
      <input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={minLength} required />
      {state.error && <p className="error" role="alert">{state.error}</p>}
      <button className="full" type="submit" disabled={pending}>
        {pending ? "저장 중…" : "비밀번호 바꾸기"}
      </button>
    </form>
  );
}
