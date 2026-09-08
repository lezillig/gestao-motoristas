"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { inputClass } from "@/lib/ui";

export type CheckboxOption = { value: string; label: string };

// Filtro multi-selecao no modelo Excel: lista de checkboxes que fica
// aberta enquanto marca varios, com um "(Selecionar tudo)" no topo — em vez
// do combobox com busca+chips (ComboboxFilter) usado nos outros filtros
// desta tela, que faz mais sentido pra listas grandes/livres (sindicato,
// cargo). Aqui a lista e curta e fixa (situacao da CNH), entao o modelo de
// checkbox e mais rapido de usar.
export default function CheckboxDropdownFilter({
  name,
  label,
  options,
  defaultValue = [],
  allLabel = "Todas",
}: {
  name: string;
  label: string;
  options: CheckboxOption[];
  defaultValue?: string[];
  allLabel?: string;
}) {
  const [selected, setSelected] = useState<string[]>(() =>
    defaultValue.filter((v) => options.some((o) => o.value === v))
  );
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function toggle(value: string) {
    setSelected((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));
  }

  const allChecked = options.length > 0 && selected.length === options.length;
  function toggleAll() {
    setSelected(allChecked ? [] : options.map((o) => o.value));
  }

  const buttonLabel =
    selected.length === 0
      ? allLabel
      : selected.length === 1
        ? (options.find((o) => o.value === selected[0])?.label ?? allLabel)
        : `${selected.length} selecionadas`;

  return (
    <div ref={rootRef} className="relative">
      <label className="mb-1 block text-xs font-medium text-slate-600">{label}</label>
      {selected.map((v) => (
        <input key={v} type="hidden" name={name} value={v} />
      ))}
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((o) => !o)}
        className={`${inputClass} flex items-center justify-between gap-2 text-left`}
      >
        <span className="truncate">{buttonLabel}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
      </button>
      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-10 mt-1 max-h-72 w-full min-w-[220px] overflow-auto rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-lg"
        >
          <li className="border-b border-slate-100 px-3 py-1.5">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={allChecked}
                onChange={toggleAll}
                className="h-3.5 w-3.5 rounded border-slate-300 text-blue-700 focus:ring-blue-600"
              />
              <span className="font-medium text-slate-700">(Selecionar tudo)</span>
            </label>
          </li>
          {options.map((o) => (
            <li key={o.value} className="px-3 py-1.5 hover:bg-slate-50">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={selected.includes(o.value)}
                  onChange={() => toggle(o.value)}
                  className="h-3.5 w-3.5 rounded border-slate-300 text-blue-700 focus:ring-blue-600"
                />
                <span className="text-slate-700">{o.label}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
