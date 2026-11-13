"use server";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { supabaseServer } from "@/lib/supabase/server";
import { safeNext } from "@/lib/auth/user";

function back(mode: string, next: string, key: "error" | "notice", message: string): never {
  redirect(`/login?mode=${mode}&next=${encodeURIComponent(next)}&${key}=${encodeURIComponent(message)}`);
}

export async function signIn(form: FormData) {
  const email = String(form.get("email") ?? "").trim(), password = String(form.get("password") ?? "");
  const next = safeNext(form.get("next"));
  if (!email || !password) back("signin", next, "error", "Enter your email and password.");
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) back("signin", next, "error", error.message === "Email not confirmed" ? "Confirm your email first. Check your inbox for the link." : "That email and password don't match.");
  redirect(next);
}

export async function signUp(form: FormData) {
  const email = String(form.get("email") ?? "").trim(), password = String(form.get("password") ?? "");
  const next = safeNext(form.get("next"));
  if (!email) back("signup", next, "error", "Enter your email.");
  if (password.length < 8) back("signup", next, "error", "Use a password of at least 8 characters.");
  const origin = process.env.NEXT_PUBLIC_APP_URL || (await headers()).get("origin") || "http://localhost:3000";
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.signUp({
    email, password,
    options: { emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}` },
  });
  if (error) back("signup", next, "error", error.message);
  if (data.session) redirect(next);
  back("signin", next, "notice", "Account created. Check your email for the confirmation link, then sign in.");
}

export async function signOut() {
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  redirect("/");
}
