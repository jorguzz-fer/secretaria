"use client";

import { useActionState } from "react";
import { updateSecretariaConfigAction } from "@/app/actions/modules";

const I =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const T = `${I} font-mono min-h-24`;
const L = "block text-sm font-medium mb-1";

interface Props {
  agentName: string;
  businessName: string;
  role: string;
  tone: "formal" | "informal" | "consultivo";
  productInfo: string;
  goal: string;
  instructions: string;
  canQuotePrice: boolean;
}

export function SecretariaConfigForm(props: Props) {
  const [state, action, pending] = useActionState(updateSecretariaConfigAction, null);

  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="agentName" className={L}>
            Nome da IA
          </label>
          <input id="agentName" name="agentName" defaultValue={props.agentName} className={I} />
          <p className="text-xs text-muted-foreground mt-1">Como a IA se apresenta ao lead.</p>
        </div>
        <div>
          <label htmlFor="businessName" className={L}>
            Nome do negócio
          </label>
          <input
            id="businessName"
            name="businessName"
            defaultValue={props.businessName}
            placeholder="Ex.: Faculdade Medicine"
            className={I}
          />
          <p className="text-xs text-muted-foreground mt-1">Deixe vazio para não mencionar.</p>
        </div>
      </div>

      <div>
        <label htmlFor="role" className={L}>
          Função / persona
        </label>
        <input
          id="role"
          name="role"
          defaultValue={props.role}
          placeholder="um SDR consultivo especializado em..."
          className={I}
        />
        <p className="text-xs text-muted-foreground mt-1">
          O que a IA é. Completa a frase &ldquo;Você é [Nome], ___&rdquo;.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="tone" className={L}>
            Tom
          </label>
          <select id="tone" name="tone" defaultValue={props.tone} className={I}>
            <option value="consultivo">Consultivo</option>
            <option value="formal">Formal</option>
            <option value="informal">Informal</option>
          </select>
        </div>
        <div>
          <label htmlFor="goal" className={L}>
            Objetivo da conversa
          </label>
          <input
            id="goal"
            name="goal"
            defaultValue={props.goal}
            placeholder="qualificar o lead e conduzir para agendamento"
            className={I}
          />
        </div>
      </div>

      <div>
        <label htmlFor="productInfo" className={L}>
          Produto / serviço e preços
        </label>
        <textarea
          id="productInfo"
          name="productInfo"
          defaultValue={props.productInfo}
          placeholder={"Ex.:\nEspecialização em Cardiologia — 18 meses, presencial.\nInvestimento: 12x R$ 890. Turma inicia em março."}
          className={T}
        />
        <p className="text-xs text-muted-foreground mt-1">
          A IA só fala o que estiver aqui — nunca inventa preços/datas. Vazio = respostas genéricas.
        </p>
      </div>

      <div>
        <label htmlFor="instructions" className={L}>
          Instruções adicionais
        </label>
        <textarea
          id="instructions"
          name="instructions"
          defaultValue={props.instructions}
          placeholder="Regras específicas, o que evitar, FAQ curto..."
          className={T}
        />
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="canQuotePrice"
          defaultChecked={props.canQuotePrice}
          className="rounded"
        />
        A IA pode informar preços/condições diretamente ao lead
      </label>

      <div className="flex items-center gap-4 pt-1">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {pending ? "Salvando..." : "Salvar persona"}
        </button>
        {state && "error" in state && <p className="text-xs text-destructive">{state.error}</p>}
        {state && "success" in state && <p className="text-xs text-green-600">{state.success}</p>}
      </div>
    </form>
  );
}
