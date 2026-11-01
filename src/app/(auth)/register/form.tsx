"use client";

import { useActionState } from "react";
import { signUp, type FormState } from "../actions";
import { Field, FormAlert, SubmitButton } from "@/components/forms";

export function RegisterForm() {
  const [state, action] = useActionState<FormState, FormData>(signUp, {});
  if (state.message) return <FormAlert message={state.message} />;
  return (
    <form action={action} className="stack" noValidate>
      <FormAlert error={state.error} />
      <Field id="fullName" label="Your name" autoComplete="name" required maxLength={120} defaultValue={state.fields?.fullName} />
      <Field id="email" label="Email" type="email" autoComplete="email" required defaultValue={state.fields?.email} />
      <Field
        id="password"
        label="Password"
        type="password"
        autoComplete="new-password"
        required
        minLength={10}
        hint="At least 10 characters."
      />
      <SubmitButton pendingLabel="Creating account…">Create account</SubmitButton>
    </form>
  );
}
