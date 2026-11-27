"use client";

import { useActionState } from "react";
import { loginAction, type LoginState } from "./actions";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(loginAction, {});
  return (
    <form action={action}>
      <input type="hidden" name="next" value={next} />
      <label htmlFor="loginId">아이디</label>
      <input id="loginId" name="loginId" type="text" autoComplete="username" defaultValue={state.loginId} autoFocus={!state.loginId} required />
      <label htmlFor="password">비밀번호</label>
      <input id="password" name="password" type="password" autoComplete="current-password" autoFocus={!!state.loginId} required />
      {state.error && <p className="error" role="alert">{state.error}</p>}
      <button className="full" type="submit" disabled={pending}>
        {pending ? "확인 중…" : "로그인"}
      </button>
    </form>
  );
}
