"use client";

import { useActionState } from "react";
import { savePreferences, type ActionState } from "../actions";
import { FormAlert, SubmitButton } from "@/components/forms";
import { CATEGORIES, CATEGORY_LABELS, type AlertCategory } from "@/lib/email/classify";
import type { Preferences } from "@/lib/db/types";

const DESCRIPTIONS: Record<AlertCategory, string> = {
  buyer_message: "A buyer sent you a message. You'll read it on Fiverr.",
  new_order: "A buyer placed a new order.",
  order_update: "Changes to an existing order: delivery, revisions, cancellations.",
  payment: "Earnings, clearances and withdrawals.",
  policy: "Terms, policy changes and account warnings.",
  account_security: "Sign-ins, password changes and verification codes.",
  general: "Other recognised Fiverr announcements.",
  unclassified: "From Fiverr, but not matched to a known type. Off by default to avoid noise.",
};

export function PreferencesForm({ prefs }: { prefs: Preferences }) {
  const [state, action] = useActionState<ActionState, FormData>(savePreferences, {});
  return (
    <form action={action} className="stack-lg">
      <section className="panel">
        <label className="switch-row">
          <span className="grow">
            <b>Pause all alerts</b>
            <small>Stop WhatsApp delivery without disconnecting anything. Notifications are still recorded.</small>
          </span>
          <input type="checkbox" role="switch" name="alerts_paused" defaultChecked={prefs.alerts_paused} className="switch" />
        </label>
      </section>
      <fieldset className="panel">
        <legend>Categories</legend>
        {CATEGORIES.map((c) => (
          <label key={c} className="switch-row">
            <span className="grow">
              <b>{CATEGORY_LABELS[c]}</b>
              <small>{DESCRIPTIONS[c]}</small>
            </span>
            <input type="checkbox" role="switch" name={c} defaultChecked={prefs[c]} className="switch" />
          </label>
        ))}
      </fieldset>
      <div className="row sticky-actions">
        <FormAlert error={state.error} message={state.message} />
        <SubmitButton pendingLabel="Saving…">Save preferences</SubmitButton>
      </div>
    </form>
  );
}
