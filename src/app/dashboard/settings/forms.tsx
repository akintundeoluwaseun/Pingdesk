"use client";

import { useActionState, useState } from "react";
import { deleteAccount, saveProfile, saveRetention, type ActionState } from "../actions";
import { Field, FormAlert, SubmitButton } from "@/components/forms";

export function ProfileForm({ fullName, timezone, zones, email }: { fullName: string; timezone: string; zones: string[]; email: string }) {
  const [state, action] = useActionState<ActionState, FormData>(saveProfile, {});
  return (
    <form action={action} className="stack">
      <Field id="email" label="Email" value={email} readOnly disabled />
      <Field id="fullName" label="Name" defaultValue={fullName} required maxLength={120} autoComplete="name" />
      <div className="field">
        <label htmlFor="timezone">Time zone</label>
        <select id="timezone" name="timezone" defaultValue={timezone}>
          {zones.map((z) => (
            <option key={z} value={z}>
              {z.replaceAll("_", " ")}
            </option>
          ))}
        </select>
        <p className="hint">Used for times in your dashboard and WhatsApp alerts.</p>
      </div>
      <div className="row">
        <FormAlert error={state.error} message={state.message} />
        <SubmitButton pendingLabel="Saving…">Save profile</SubmitButton>
      </div>
    </form>
  );
}

export function DeleteAccountForm({ email }: { email: string }) {
  const [state, action] = useActionState<ActionState, FormData>(deleteAccount, {});
  const [typed, setTyped] = useState("");
  const matches = typed.trim().toLowerCase() === email.toLowerCase() && email !== "";
  return (
    <form action={action} className="stack">
      <FormAlert error={state.error} />
      <Field
        id="confirmEmail"
        label={`Type ${email} to confirm`}
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        autoComplete="off"
        spellCheck={false}
      />
      <div>
        {matches ? (
          <SubmitButton variant="danger" pendingLabel="Deleting…">
            Delete account permanently
          </SubmitButton>
        ) : (
          <button type="button" className="btn btn-danger" disabled>
            Delete account permanently
          </button>
        )}
      </div>
    </form>
  );
}

export function RetentionForm({ days }: { days: number }) {
  const [state, action] = useActionState<ActionState, FormData>(saveRetention, {});
  return (
    <form action={action} className="stack narrow">
      <div className="field">
        <label htmlFor="retentionDays">Keep alert history for</label>
        <select id="retentionDays" name="retentionDays" defaultValue={String(days)}>
          <option value="30">30 days</option>
          <option value="90">90 days</option>
          <option value="180">180 days</option>
          <option value="365">1 year</option>
        </select>
        <p className="hint">Older alerts and their delivery records are deleted automatically each day. Activity entries are kept for a year.</p>
      </div>
      <div className="row">
        <FormAlert error={state.error} message={state.message} />
        <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
      </div>
    </form>
  );
}
