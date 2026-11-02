"use client";

import Link from "next/link";
import { useActionState } from "react";
import { requestPasswordReset, type FormState } from "../actions";
import { Field, FormAlert, SubmitButton } from "@/components/forms";

export default function ForgotPasswordPage() {
  const [state, action] = useActionState<FormState, FormData>(requestPasswordReset, {});
  return (
    <>
      <h1 className="auth-title">Reset your password</h1>
      <p className="auth-sub">We&apos;ll email you a link to choose a new one.</p>
      {state.message ? (
        <FormAlert message={state.message} />
      ) : (
        <form action={action} className="stack" noValidate>
          <FormAlert error={state.error} />
          <Field id="email" label="Email" type="email" autoComplete="email" required />
          <SubmitButton pendingLabel="Sending…">Send reset link</SubmitButton>
        </form>
      )}
      <p className="auth-switch">
        <Link href="/login">Back to sign in</Link>
      </p>
    </>
  );
}
