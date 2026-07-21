import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { buildSortHref, nextSortDir, type SortDir } from "@/lib/sort";

export default function SortableTh({
  label,
  field,
  basePath,
  currentParams,
  currentSort,
  currentDir,
  className,
}: {
  label: string;
  field: string;
  basePath: string;
  currentParams: Record<string, string | undefined>;
  currentSort?: string;
  currentDir?: SortDir;
  className?: string;
}) {
  const active = currentSort === field;
  const dir = nextSortDir(currentSort, currentDir, field);
  const Icon = active ? (currentDir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;

  return (
    <th className={className}>
      <Link
        href={buildSortHref(basePath, currentParams, field, dir)}
        className={`inline-flex items-center gap-1 hover:text-slate-700 ${active ? "text-slate-800" : ""}`}
      >
        {label}
        <Icon className="h-3 w-3" />
      </Link>
    </th>
  );
}
