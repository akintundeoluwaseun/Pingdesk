"use client";

import { useActionState, useState } from "react";
import { removeNumber, requestCode, resendCode, submitCode, type WaState } from "./actions";
import { Field, FormAlert, SubmitButton } from "@/components/forms";

export function PhoneForm({ initialPhone, cta = "Send verification code" }: { initialPhone?: string; cta?: string }) {
  const [state, action] = useActionState<WaState, FormData>(requestCode, {});
  return (
    <form action={action} className="stack narrow">
      <FormAlert error={state.error} message={state.message} />
      <Field
        id="phone"
        label="WhatsApp number"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        placeholder="+234 803 123 4567"
        defaultValue={initialPhone}
        hint="Include your country code. Nigerian numbers starting with 0 also work."
        required
      />
      <label className="check consent">
        <input type="checkbox" name="consent" required />
        <span>
          I agree to receive PingDesk notification alerts on WhatsApp at this number. Alerts describe the type of Fiverr notification, never
          its contents. I can reply STOP or remove the number at any time.
        </span>
      </label>
      <div>
        <SubmitButton pendingLabel="Sending code…">{cta}</SubmitButton>
      </div>
    </form>
  );
}

export function CodeForm({ phoneLast4 }: { phoneLast4: string }) {
  const [state, action] = useActionState<WaState, FormData>(submitCode, {});
  const [resendState, resend] = useActionState<WaState>(resendCode, {});
  const [changing, setChanging] = useState(false);
  if (changing) return <PhoneForm cta="Send code to new number" />;
  return (
    <div className="stack narrow">
      <form action={action} className="stack">
        <FormAlert error={state.error ?? resendState.error} message={state.message ?? resendState.message} />
        <Field
          id="code"
          label={`Code sent to WhatsApp ending ${phoneLast4}`}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={7}
          placeholder="123456"
          className="code-input"
          required
        />
        <div className="row">
          <SubmitButton pendingLabel="Checking…">Verify number</SubmitButton>
        </div>
      </form>
      <div className="row small muted">
        <form action={resend}>
          <button type="submit" className="text-link small">
            Resend code
          </button>
        </form>
        <span aria-hidden>·</span>
        <button type="button" className="text-link small" onClick={() => setChanging(true)}>
          Use a different number
        </button>
      </div>
    </div>
  );
}

export function RemoveNumber() {
  const [state, action] = useActionState<WaState>(removeNumber, {});
  const [confirming, setConfirming] = useState(false);
  if (!confirming)
    return (
      <div className="row">
        <FormAlert error={state.error} />
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirming(true)}>
          Remove number
        </button>
      </div>
    );
  return (
    <form action={action} className="confirm-box">
      <p>Stop all WhatsApp alerts and remove this number?</p>
      <div className="row">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirming(false)}>
          Keep it
        </button>
        <SubmitButton variant="danger" className="btn-sm" pendingLabel="Removing…">
          Remove number
        </SubmitButton>
      </div>
    </form>
  );
}

export function ChangeNumber() {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <button type="button" className="btn btn-outline btn-sm" onClick={() => setOpen(true)}>
        Change number
      </button>
    );
  return <PhoneForm cta="Send code to new number" />;
}
