import { describe, it, expect } from "vitest";
import { authConfig, PUBLIC_PATHS } from "@/lib/auth.config";

// Rotas de integração server-to-server: precisam passar pelo middleware SEM
// sessão JWT (cada handler tem autenticação própria — secret/assinatura).
// Regressão real: /api/inngest fora da lista fazia o middleware devolver a
// página de login pro servidor Inngest → "can't find your application".
const INTEGRATION_PATHS = [
  "/api/inngest",
  "/api/webhooks/whatsapp",
  "/api/webhooks/chatwoot",
  "/api/cron/followups",
  "/api/health",
];

function authorized(pathname: string, loggedIn: boolean) {
  return authConfig.callbacks!.authorized!({
    auth: loggedIn ? ({ user: { id: "u1" } } as never) : null,
    request: { nextUrl: new URL(`https://app.example.com${pathname}`) } as never,
  });
}

describe("middleware PUBLIC_PATHS", () => {
  it.each(INTEGRATION_PATHS)("%s passa sem sessão (auth própria no handler)", (path) => {
    expect(authorized(path, false)).toBe(true);
  });

  it("rota protegida continua bloqueada sem sessão", () => {
    expect(authorized("/dashboard", false)).toBe(false);
    expect(authorized("/configuracoes/modulos", false)).toBe(false);
  });

  it("prefixo não vaza: /api/inngest-outra-coisa não é público", () => {
    expect(PUBLIC_PATHS).toContain("/api/inngest");
    expect(authorized("/api/inngestx", false)).toBe(false);
  });
});
