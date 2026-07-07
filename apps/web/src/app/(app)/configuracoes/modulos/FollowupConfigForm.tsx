"use client";

import { useActionState } from "react";
import { updateFollowupConfigAction } from "@/app/actions/modules";

const I =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring font-mono";
const L = "block text-sm font-medium mb-1";

interface Props {
  sequenceDays: number[];
  stopOnReply: boolean;
}

export function FollowupConfigForm({ sequenceDays, stopOnReply }: Props) {
  const [state, action, pending] = useActionState(updateFollowupConfigAction, null);

  return (
    <form action={action} className="space-y-4">
      <div className="max-w-sm">
        <label htmlFor="sequenceDays" className={L}>
          Dias da cadência
        </label>
        <input
          id="sequenceDays"
          name="sequenceDays"
          defaultValue={sequenceDays.join(", ")}
          placeholder="1, 3, 7"
          className={I}
        />
        <p className="text-xs text-muted-foreground mt-1">
          Números crescentes separados por vírgula (ex.: <span className="font-mono">1, 3, 7</span>).
        </p>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="stopOnReply" defaultChecked={stopOnReply} className="rounded" />
        Parar a sequência quando o lead responder
      </label>

      <div className="flex items-center gap-4 pt-1">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {pending ? "Salvando..." : "Salvar cadência"}
        </button>
        {state && "error" in state && <p className="text-xs text-destructive">{state.error}</p>}
        {state && "success" in state && <p className="text-xs text-green-600">{state.success}</p>}
      </div>
    </form>
  );
}
