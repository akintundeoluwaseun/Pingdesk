"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signIn, type FormState } from "../actions";
import { Field, FormAlert, SubmitButton } from "@/components/forms";

export function LoginForm({ next, notice }: { next?: string; notice?: string }) {
  const [state, action] = useActionState<FormState, FormData>(signIn, {});
  return (
    <form action={action} className="stack" noValidate>
      <FormAlert error={state.error ?? notice} />
      <input type="hidden" name="next" value={next ?? "/dashboard"} />
      <Field id="email" label="Email" type="email" autoComplete="email" required defaultValue={state.fields?.email} />
      <Field id="password" label="Password" type="password" autoComplete="current-password" required />
      <Link href="/forgot-password" className="text-link small">
        Forgot your password?
      </Link>
      <SubmitButton pendingLabel="Signing in…">Sign in</SubmitButton>
    </form>
  );
}
