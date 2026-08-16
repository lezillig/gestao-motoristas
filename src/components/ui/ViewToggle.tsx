import Link from "next/link";

export type VisaoHoras = "totais" | "extras";

export default function ViewToggle({
  basePath,
  params,
  current,
}: {
  basePath: string;
  params: Record<string, string | undefined>;
  current: VisaoHoras;
}) {
  const hrefFor = (visao: VisaoHoras) => {
    const sp = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value) sp.set(key, value);
    }
    sp.set("visao", visao);
    return `${basePath}?${sp.toString()}`;
  };

  const optionClass = (active: boolean) =>
    `rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
      active ? "bg-blue-700 text-white" : "text-slate-600 hover:bg-slate-100"
    }`;

  return (
    <div className="inline-flex rounded-lg border border-slate-300 p-0.5">
      <Link href={hrefFor("totais")} className={optionClass(current === "totais")}>
        Horas totais
      </Link>
      <Link href={hrefFor("extras")} className={optionClass(current === "extras")}>
        Horas extras
      </Link>
    </div>
  );
}
