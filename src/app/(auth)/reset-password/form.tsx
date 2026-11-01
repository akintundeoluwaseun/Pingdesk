"use client";

import { useActionState } from "react";
import { updatePassword, type FormState } from "../actions";
import { Field, FormAlert, SubmitButton } from "@/components/forms";

export function ResetForm() {
  const [state, action] = useActionState<FormState, FormData>(updatePassword, {});
  return (
    <form action={action} className="stack" noValidate>
      <FormAlert error={state.error} />
      <Field id="password" label="New password" type="password" autoComplete="new-password" required minLength={10} hint="At least 10 characters." />
      <Field id="confirm" label="Confirm new password" type="password" autoComplete="new-password" required />
      <SubmitButton pendingLabel="Saving…">Save password</SubmitButton>
    </form>
  );
}
