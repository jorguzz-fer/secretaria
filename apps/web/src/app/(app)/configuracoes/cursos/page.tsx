import type { Metadata } from "next";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma, Prisma } from "@crm/db";

export const metadata: Metadata = { title: "Catálogo de cursos" };

interface Props {
  searchParams: Promise<{ q?: string; area?: string }>;
}

export default async function CursosPage({ searchParams }: Props) {
  const session = await auth();
  if (!session) redirect("/login");

  const tenantId = session.user.tenantId;
  const params = await searchParams;
  const q = params.q?.trim() ?? "";
  const area = params.area?.trim() ?? "";

  const where: Prisma.CourseWhereInput = { tenantId, active: true };
  if (area) where.area = area;
  if (q) {
    where.OR = [
      { title: { contains: q, mode: "insensitive" } },
      { summary: { contains: q, mode: "insensitive" } },
      { area: { contains: q, mode: "insensitive" } },
      { audience: { contains: q, mode: "insensitive" } },
    ];
  }

  const [courses, areasRaw, total] = await Promise.all([
    prisma.course.findMany({
      where,
      orderBy: [{ area: "asc" }, { number: "asc" }],
      take: 200,
      select: {
        id: true,
        number: true,
        area: true,
        title: true,
        workload: true,
        priceRaw: true,
        url: true,
      },
    }),
    prisma.course.groupBy({
      by: ["area"],
      where: { tenantId, active: true },
      _count: { area: true },
      orderBy: { area: "asc" },
    }),
    prisma.course.count({ where: { tenantId, active: true } }),
  ]);

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Catálogo de cursos</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {total} cursos catalogados. A IA usa este catálogo para responder sobre cursos, valores e
          áreas no WhatsApp (busca por área/preço + semântica quando habilitada).
        </p>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-48">
          <label htmlFor="q" className="block text-sm font-medium mb-1">
            Buscar
          </label>
          <input
            id="q"
            name="q"
            defaultValue={q}
            placeholder="Título, área, público..."
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <div className="min-w-52">
          <label htmlFor="area" className="block text-sm font-medium mb-1">
            Área
          </label>
          <select
            id="area"
            name="area"
            defaultValue={area}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">Todas ({areasRaw.length})</option>
            {areasRaw.map((a) => (
              <option key={a.area} value={a.area}>
                {a.area} ({a._count.area})
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Filtrar
        </button>
        {(q || area) && (
          <a href="/configuracoes/cursos" className="text-sm text-muted-foreground hover:text-foreground py-2">
            Limpar
          </a>
        )}
      </form>

      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/40">
            <tr>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground w-10">Nº</th>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground">Curso</th>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground hidden md:table-cell">Área</th>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground hidden sm:table-cell">Carga</th>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground">Valor</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {courses.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">
                  Nenhum curso encontrado. Importe o catálogo com{" "}
                  <span className="font-mono">import-courses.js</span>.
                </td>
              </tr>
            ) : (
              courses.map((c) => (
                <tr key={c.id}>
                  <td className="px-3 py-2 text-muted-foreground">{c.number ?? "—"}</td>
                  <td className="px-3 py-2">
                    {c.url ? (
                      <a href={c.url} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline">
                        {c.title}
                      </a>
                    ) : (
                      <span className="font-medium">{c.title}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 hidden md:table-cell text-muted-foreground">{c.area}</td>
                  <td className="px-3 py-2 hidden sm:table-cell text-muted-foreground">{c.workload ?? "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{c.priceRaw ?? "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {courses.length === 200 && (
        <p className="text-xs text-muted-foreground">Mostrando os primeiros 200 — refine a busca.</p>
      )}
    </div>
  );
}
