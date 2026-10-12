"use client";

import { useActionState } from "react";
import { login, type LoginState } from "@/app/admin/actions";

export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, null);
  return (
    <form action={action} className="grid gap-3">
      <label className="grid gap-1.5 text-sm text-muted">
        Password
        <input
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="w-full rounded-xl bg-panel2 px-3.5 py-2.5 text-[15px] text-ink ring-1 ring-line focus:ring-2 focus:ring-accent focus:outline-none"
        />
      </label>
      <button type="submit" disabled={pending} className="rounded-xl bg-accent px-5 py-2.5 font-medium text-white transition hover:bg-accent/85 disabled:opacity-60">
        {pending ? "Checking…" : "Sign in"}
      </button>
      {state?.error && (
        <p role="alert" className="text-sm text-bad">
          {state.error}
        </p>
      )}
    </form>
  );
}
