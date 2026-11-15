"use client";

import { useActionState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/app/actions";
import { btn } from "./ui";

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

export function ActionForm({
  action,
  children,
  className = "space-y-3",
}: {
  action: Action;
  children: ReactNode;
  className?: string;
}) {
  const [state, formAction] = useActionState(action, undefined);
  return (
    <form action={formAction} className={className}>
      {children}
      {state?.error ? (
        <p role="alert" className="rounded-xl bg-tone-red px-3 py-2 text-sm text-tone-red-fg">
          {state.error}
        </p>
      ) : null}
      {state?.ok ? (
        <p role="status" className="rounded-xl bg-tone-green px-3 py-2 text-sm text-tone-green-fg">
          {state.ok}
        </p>
      ) : null}
    </form>
  );
}

export function SubmitButton({
  children,
  variant = "primary",
  name,
  value,
  className = "",
}: {
  children: ReactNode;
  variant?: keyof typeof btn;
  name?: string;
  value?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" name={name} value={value} disabled={pending} className={`${btn[variant]} ${className}`}>
      {pending ? "جارٍ التنفيذ…" : children}
    </button>
  );
}
