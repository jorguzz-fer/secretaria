"use client";

import { useActionState } from "react";
import { toggleModuleAction } from "@/app/actions/modules";

interface ModuleRow {
  key: string;
  label: string;
  description: string;
  enabled: boolean;
}

function ModuleToggle({ module }: { module: ModuleRow }) {
  const [state, action, pending] = useActionState(toggleModuleAction, null);

  return (
    <form
      action={action}
      className="flex items-center justify-between gap-4 rounded-lg border border-border bg-card p-4"
    >
      <div className="min-w-0">
        <p className="font-medium text-sm">{module.label}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{module.description}</p>
        {state && "error" in state && (
          <p className="text-xs text-destructive mt-1">{state.error}</p>
        )}
      </div>

      <input type="hidden" name="moduleKey" value={module.key} />
      {/* Envia o estado desejado = inverso do atual */}
      <input type="hidden" name="enabled" value={module.enabled ? "false" : "true"} />
      <button
        type="submit"
        disabled={pending}
        role="switch"
        aria-checked={module.enabled}
        aria-label={`${module.enabled ? "Desativar" : "Ativar"} ${module.label}`}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
          module.enabled ? "bg-primary" : "bg-input"
        }`}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
            module.enabled ? "translate-x-5" : "translate-x-0.5"
          }`}
        />
      </button>
    </form>
  );
}

export function ModulesList({ modules }: { modules: ModuleRow[] }) {
  return (
    <section className="space-y-3">
      {modules.map((m) => (
        <ModuleToggle key={m.key} module={m} />
      ))}
    </section>
  );
}
