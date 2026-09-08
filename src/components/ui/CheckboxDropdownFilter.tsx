"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { inputClass } from "@/lib/ui";

export type CheckboxOption = { value: string; label: string };

function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

// Filtro multi-selecao no modelo Excel: campo de busca + lista de
// checkboxes que fica aberta enquanto marca varios, com um "(Selecionar
// tudo)" no topo que so afeta os itens visiveis na busca atual (mesmo
// comportamento do autofiltro do Excel) — substitui o ComboboxFilter
// (busca+chips) nos filtros de selecao multipla desta tela.
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
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setText("");
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const filtered = useMemo(() => {
    const q = normalize(text.trim());
    if (!q) return options;
    return options.filter((o) => normalize(o.label).includes(q));
  }, [text, options]);

  function toggle(value: string) {
    setSelected((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));
  }

  // "Selecionar tudo" so age sobre o que esta visivel na busca atual - item
  // ja marcado que saiu da busca continua marcado, so nao aparece na lista.
  const filteredValues = useMemo(() => filtered.map((o) => o.value), [filtered]);
  const allFilteredChecked = filteredValues.length > 0 && filteredValues.every((v) => selected.includes(v));
  function toggleAllFiltered() {
    if (allFilteredChecked) {
      const toRemove = new Set(filteredValues);
      setSelected((prev) => prev.filter((v) => !toRemove.has(v)));
    } else {
      setSelected((prev) => [...new Set([...prev, ...filteredValues])]);
    }
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
        onClick={() => {
          setOpen((o) => !o);
          requestAnimationFrame(() => inputRef.current?.focus());
        }}
        className={`${inputClass} flex items-center justify-between gap-2 text-left`}
      >
        <span className="truncate">{buttonLabel}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
      </button>
      {open && (
        <div className="absolute z-10 mt-1 w-full min-w-[240px] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
          <div className="border-b border-slate-100 p-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                ref={inputRef}
                type="text"
                autoComplete="off"
                placeholder="Buscar…"
                className={`${inputClass} pl-8 text-sm`}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </div>
          </div>
          <ul id={listId} role="listbox" className="max-h-64 overflow-auto py-1 text-sm">
            <li className="border-b border-slate-100 px-3 py-1.5">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={allFilteredChecked}
                  onChange={toggleAllFiltered}
                  className="h-3.5 w-3.5 rounded border-slate-300 text-blue-700 focus:ring-blue-600"
                />
                <span className="font-medium text-slate-700">(Selecionar tudo)</span>
              </label>
            </li>
            {filtered.length === 0 && <li className="px-3 py-1.5 text-slate-400">Nenhum resultado</li>}
            {filtered.map((o) => (
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
        </div>
      )}
    </div>
  );
}
