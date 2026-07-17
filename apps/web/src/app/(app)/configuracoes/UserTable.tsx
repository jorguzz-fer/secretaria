"use client";

import { useActionState } from "react";
import {
  updateUserRoleAction,
  toggleUserActiveAction,
  resetUserPasswordAction,
} from "@/app/actions/settings";

const ROLE_LABELS: Record<string, string> = {
  SUPERADMIN: "Super Admin",
  ADMIN:      "Admin",
  SUPERVISOR: "Supervisor",
  ANALYST:    "Analista",
  VIEWER:     "Visualizador",
};

const ROLE_STYLE: Record<string, string> = {
  SUPERADMIN: "bg-red-100 text-red-700",
  ADMIN:      "bg-violet-100 text-violet-700",
  SUPERVISOR: "bg-blue-100 text-blue-700",
  ANALYST:    "bg-green-100 text-green-700",
  VIEWER:     "bg-zinc-100 text-zinc-600",
};

interface User {
  id: string; name: string; email: string; role: string; active: boolean; createdAt: Date;
}

interface Props {
  users: User[];
  currentUserId: string;
  isAdmin: boolean;
}

function RoleSelect({ user, currentUserId }: { user: User; currentUserId: string }) {
  const [state, action, pending] = useActionState(updateUserRoleAction, null);
  const isSelf = user.id === currentUserId;

  return (
    <form action={action} className="flex items-center gap-1">
      <input type="hidden" name="userId" value={user.id} />
      {isSelf || !user.active ? (
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ROLE_STYLE[user.role] ?? ROLE_STYLE.VIEWER}`}>
          {ROLE_LABELS[user.role] ?? user.role}
        </span>
      ) : (
        <>
          <select
            name="role"
            defaultValue={user.role}
            disabled={pending}
            className="rounded border border-input bg-background px-2 py-0.5 text-xs focus-visible:outline-none"
            onChange={(e) => {
              const form = e.target.closest("form") as HTMLFormElement;
              form?.requestSubmit();
            }}
          >
            {["ADMIN", "SUPERVISOR", "ANALYST", "VIEWER"].map((r) => (
              <option key={r} value={r}>{ROLE_LABELS[r]}</option>
            ))}
          </select>
          {state && "error" in state && <span className="text-xs text-destructive">{state.error}</span>}
        </>
      )}
    </form>
  );
}

function ToggleActiveButton({ user, currentUserId }: { user: User; currentUserId: string }) {
  const [, action, pending] = useActionState(toggleUserActiveAction, null);
  const isSelf = user.id === currentUserId;
  if (isSelf) return null;

  return (
    <form action={action}>
      <input type="hidden" name="userId" value={user.id} />
      <button
        type="submit"
        disabled={pending}
        className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
          user.active
            ? "text-muted-foreground hover:text-destructive hover:bg-red-50"
            : "text-green-600 hover:bg-green-50"
        }`}
      >
        {pending ? "..." : user.active ? "Desativar" : "Reativar"}
      </button>
    </form>
  );
}

function ResetPasswordForm({ user }: { user: User }) {
  const [state, action, pending] = useActionState(resetUserPasswordAction, null);

  return (
    <details className="inline-block text-left">
      <summary className="cursor-pointer list-none rounded px-2 py-0.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50">
        Senha
      </summary>
      <form action={action} className="mt-1 flex flex-col gap-1">
        <input type="hidden" name="userId" value={user.id} />
        <input
          type="password"
          name="newPassword"
          placeholder="Nova senha (mín. 10)"
          autoComplete="new-password"
          className="w-44 rounded border border-input bg-background px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {pending ? "Salvando..." : "Redefinir"}
        </button>
        {state && "error" in state && <span className="text-xs text-destructive">{state.error}</span>}
        {state && "success" in state && <span className="text-xs text-green-600">{state.success}</span>}
      </form>
    </details>
  );
}

export function UserTable({ users, currentUserId, isAdmin }: Props) {
  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <table className="w-full text-sm">
        <thead className="border-b border-border bg-muted/40">
          <tr>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">Nome</th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground hidden md:table-cell">E-mail</th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">Papel</th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground hidden sm:table-cell">Status</th>
            {isAdmin && <th className="px-4 py-3" />}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {users.map((user) => (
            <tr key={user.id} className={`${!user.active ? "opacity-50" : ""}`}>
              <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">
                    {user.name.charAt(0).toUpperCase()}
                  </div>
                  <span className="font-medium">{user.name}</span>
                  {user.id === currentUserId && (
                    <span className="text-xs text-muted-foreground">(você)</span>
                  )}
                </div>
              </td>
              <td className="px-4 py-3 hidden md:table-cell text-muted-foreground">{user.email}</td>
              <td className="px-4 py-3">
                {isAdmin ? (
                  <RoleSelect user={user} currentUserId={currentUserId} />
                ) : (
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ROLE_STYLE[user.role] ?? ROLE_STYLE.VIEWER}`}>
                    {ROLE_LABELS[user.role] ?? user.role}
                  </span>
                )}
              </td>
              <td className="px-4 py-3 hidden sm:table-cell">
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${user.active ? "bg-green-100 text-green-700" : "bg-zinc-100 text-zinc-500"}`}>
                  {user.active ? "Ativo" : "Inativo"}
                </span>
              </td>
              {isAdmin && (
                <td className="px-4 py-3 text-right">
                  <div className="flex items-start justify-end gap-2">
                    <ResetPasswordForm user={user} />
                    <ToggleActiveButton user={user} currentUserId={currentUserId} />
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
