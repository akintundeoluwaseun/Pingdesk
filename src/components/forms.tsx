"use client";

import { useFormStatus } from "react-dom";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import type { InputHTMLAttributes, ReactNode } from "react";

export function SubmitButton({
  children,
  pendingLabel,
  variant = "primary",
  className = "",
}: {
  children: ReactNode;
  pendingLabel?: string;
  variant?: "primary" | "outline" | "danger";
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={`btn btn-${variant} ${className}`} disabled={pending} aria-busy={pending}>
      {pending ? <Loader2 size={15} className="spin" aria-hidden /> : null}
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}

export function Field({
  label,
  hint,
  id,
  ...input
}: { label: string; hint?: string; id: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} name={id} aria-describedby={hint ? `${id}-hint` : undefined} {...input} />
      {hint ? (
        <p id={`${id}-hint`} className="hint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function FormAlert({ error, message }: { error?: string; message?: string }) {
  if (error)
    return (
      <p className="alert alert-error" role="alert">
        <AlertCircle size={16} aria-hidden /> {error}
      </p>
    );
  if (message)
    return (
      <p className="alert alert-success" role="status">
        <CheckCircle2 size={16} aria-hidden /> {message}
      </p>
    );
  return null;
}
