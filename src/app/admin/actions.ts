"use server";

import { redirect } from "next/navigation";
import { loginWithPassword, logout } from "@/lib/admin";

export type LoginState = { error: string } | null;

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const ok = await loginWithPassword(String(formData.get("password") ?? ""));
  if (!ok) return { error: "Wrong password, or admin login is not configured on this deployment." };
  redirect("/podcasts");
}

export async function signOut() {
  await logout();
  redirect("/");
}
