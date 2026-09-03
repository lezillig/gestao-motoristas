"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { inputClass } from "@/lib/ui";

export type ComboboxOption = { value: string; label: string };

// Select de filtro com busca: digitar filtra a lista visivel (por
// substring, sem acento/case), e clicar (ou Enter) numa opcao seleciona.
// Value real vai num <input type="hidden"> com o mesmo `name` que o
// <select> tinha antes, entao funciona dentro do mesmo <form method="get">
// sem mudar nada no server (searchParams, filtro no Prisma).
//
// So aceita valores que existem em `options` — digitar algo sem match e dar
// blur sem escolher reverte pro ultimo valor valido, pra nunca submeter um
// texto que nao corresponde a nenhum id/valor real.
export default function ComboboxFilter({
  name,
  label,
  options,
  defaultValue,
  allLabel = "Todos",
}: {
  name: string;
  label: string;
  options: ComboboxOption[];
  defaultValue?: string;
  allLabel?: string;
}) {
  const allOption: ComboboxOption = { value: "", label: allLabel };
  const allOptions = useMemo(() => [allOption, ...options], [options, allLabel]);

  const initial = allOptions.find((o) => o.value === (defaultValue ?? "")) ?? allOption;
  const [value, setValue] = useState(initial.value);
  const [text, setText] = useState(initial.label);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const normalize = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase();

  const filtered = useMemo(() => {
    const q = normalize(text.trim());
    if (!q || text === initial.label) return allOptions;
    return allOptions.filter((o) => normalize(o.label).includes(q));
  }, [text, allOptions, initial.label]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setText(allOptions.find((o) => o.value === value)?.label ?? allLabel);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [value, allOptions, allLabel]);

  function choose(option: ComboboxOption) {
    setValue(option.value);
    setText(option.label);
    setOpen(false);
  }

  return (
    <div ref={rootRef} className="relative">
      <label className="mb-1 block text-xs font-medium text-slate-600">{label}</label>
      <input type="hidden" name={name} value={value} />
      <div className="relative">
        <input
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          autoComplete="off"
          className={`${inputClass} pr-8`}
          value={text}
          onFocus={(e) => {
            setOpen(true);
            setHighlight(0);
            e.target.select(); // digitar direto substitui o texto atual ("Todos" ou a opcao escolhida)
          }}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
            setHighlight(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setHighlight((h) => Math.min(h + 1, filtered.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHighlight((h) => Math.max(h - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              const option = filtered[highlight];
              if (option) choose(option);
            } else if (e.key === "Escape") {
              setOpen(false);
              setText(allOptions.find((o) => o.value === value)?.label ?? allLabel);
            }
          }}
        />
        <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      </div>
      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-10 mt-1 max-h-64 w-full min-w-[200px] overflow-auto rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-lg"
        >
          {filtered.length === 0 && <li className="px-3 py-1.5 text-slate-400">Nenhum resultado</li>}
          {filtered.map((option, i) => (
            <li
              key={option.value || "__all__"}
              role="option"
              aria-selected={option.value === value}
              className={`cursor-pointer px-3 py-1.5 ${
                i === highlight ? "bg-blue-50 text-blue-800" : "text-slate-700"
              } ${option.value === value ? "font-medium" : ""}`}
              onMouseEnter={() => setHighlight(i)}
              onMouseDown={(e) => {
                e.preventDefault(); // evita blur antes do click
                choose(option);
              }}
            >
              {option.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
