"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Check, Pencil, RefreshCw } from "lucide-react";
import { disconnectInbox, renameInbox, syncNow, type ActionState } from "../actions";
import { FormAlert, SubmitButton } from "@/components/forms";

export function RenameForm({ inboxId, label, disabled }: { inboxId: string; label: string; disabled?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [state, action, pending] = useActionState<ActionState, FormData>(async (prev, form) => {
    const result = await renameInbox(prev, form);
    if (result.message) setEditing(false);
    return result;
  }, {});
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  if (!editing) {
    return (
      <div className="rename">
        <b className="truncate">{label}</b>
        {!disabled ? (
          <button type="button" className="icon-btn" aria-label={`Rename ${label}`} title="Rename" onClick={() => setEditing(true)}>
            <Pencil size={14} />
          </button>
        ) : null}
        {state.error ? <span className="field-error">{state.error}</span> : null}
      </div>
    );
  }
  return (
    <form action={action} className="rename" onKeyDown={(e) => e.key === "Escape" && setEditing(false)}>
      <input type="hidden" name="inboxId" value={inboxId} />
      <label className="sr-only" htmlFor={`label-${inboxId}`}>
        Inbox name
      </label>
      <input ref={input} id={`label-${inboxId}`} name="label" defaultValue={label} maxLength={60} required className="inline-input" />
      <button type="submit" className="icon-btn" aria-label="Save name" title="Save" disabled={pending}>
        <Check size={15} />
      </button>
    </form>
  );
}

export function DisconnectForm({ inboxId, label, alreadyDisconnected }: { inboxId: string; label: string; alreadyDisconnected: boolean }) {
  const [state, action] = useActionState<ActionState, FormData>(disconnectInbox, {});
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <div className="disconnect">
        <FormAlert error={state.error} message={state.message} />
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirming(true)}>
          {alreadyDisconnected ? "Remove" : "Disconnect"}
        </button>
      </div>
    );
  }
  return (
    <form action={action} className="confirm-box">
      <input type="hidden" name="inboxId" value={inboxId} />
      {alreadyDisconnected ? (
        <>
          <input type="hidden" name="deleteHistory" value="on" />
          <p>
            Remove <b>{label}</b> from PingDesk? Its alert history is deleted too. This can&apos;t be undone.
          </p>
        </>
      ) : (
        <>
          <p>
            Disconnect <b>{label}</b>? PingDesk stops checking it and Google access is revoked.
          </p>
          <label className="check">
            <input type="checkbox" name="deleteHistory" /> Also delete its alert history
          </label>
        </>
      )}
      <div className="row">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirming(false)}>
          Keep it
        </button>
        <SubmitButton variant="danger" pendingLabel="Disconnecting…" className="btn-sm">
          {alreadyDisconnected ? `Remove ${label}` : `Disconnect ${label}`}
        </SubmitButton>
      </div>
    </form>
  );
}

export function SyncNowButton({ inboxId }: { inboxId: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(syncNow, {});
  return (
    <form action={action} className="sync-now">
      <input type="hidden" name="inboxId" value={inboxId} />
      <button type="submit" className="btn btn-outline btn-sm" disabled={pending}>
        <RefreshCw size={13} aria-hidden className={pending ? "spin" : undefined} /> Check now
      </button>
      {state.error || state.message ? <FormAlert error={state.error} message={state.message} /> : null}
    </form>
  );
}
