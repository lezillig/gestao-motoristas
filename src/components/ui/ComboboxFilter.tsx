"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, X } from "lucide-react";
import { inputClass } from "@/lib/ui";

export type ComboboxOption = { value: string; label: string };

function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

type Props = {
  name: string;
  label: string;
  options: ComboboxOption[];
  allLabel?: string;
} & (
  | { multiple?: false; defaultValue?: string }
  | { multiple: true; defaultValue?: string[] }
);

// Select de filtro com busca: digitar filtra a lista visivel (por
// substring, sem acento/case). Value real vai num <input type="hidden">
// com o mesmo `name` que o <select> tinha antes, entao funciona dentro do
// mesmo <form method="get"> sem mudar nada no server alem de trocar
// `searchParams.x` (string) por `searchParams.x` (string | string[]) e a
// comparacao do Prisma por `in` — Next.js ja devolve array sozinho quando
// o mesmo `name` aparece mais de uma vez na query string.
//
// `multiple` controla 2 UX bem diferentes:
//  - false (padrao, usado por ex. no "De/Para" de MergeFieldForm): 1 valor
//    so, mostrado dentro do proprio campo de texto; escolher fecha a
//    lista; sair sem escolher reverte pro ultimo valor valido.
//  - true: varios valores, cada um vira um "chip" removivel acima do
//    campo; escolher NAO fecha a lista (da pra escolher varios seguidos);
//    o campo de busca sempre fica vazio depois de cada escolha.
export default function ComboboxFilter(props: Props) {
  const { name, label, options, allLabel = "Todos" } = props;

  if (props.multiple) {
    return <MultiCombobox name={name} label={label} options={options} allLabel={allLabel} defaultValue={props.defaultValue} />;
  }
  return <SingleCombobox name={name} label={label} options={options} allLabel={allLabel} defaultValue={props.defaultValue} />;
}

function SingleCombobox({
  name,
  label,
  options,
  defaultValue,
  allLabel,
}: {
  name: string;
  label: string;
  options: ComboboxOption[];
  defaultValue?: string;
  allLabel: string;
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

function MultiCombobox({
  name,
  label,
  options,
  defaultValue,
  allLabel,
}: {
  name: string;
  label: string;
  options: ComboboxOption[];
  defaultValue?: string[];
  allLabel: string;
}) {
  const optionByValue = useMemo(() => new Map(options.map((o) => [o.value, o])), [options]);
  const [selected, setSelected] = useState<string[]>(() => (defaultValue ?? []).filter((v) => optionByValue.has(v)));
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const filtered = useMemo(() => {
    const q = normalize(text.trim());
    const pool = options.filter((o) => !selectedSet.has(o.value));
    if (!q) return pool;
    return pool.filter((o) => normalize(o.label).includes(q));
  }, [text, options, selectedSet]);

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

  function add(option: ComboboxOption) {
    setSelected((prev) => (prev.includes(option.value) ? prev : [...prev, option.value]));
    setText("");
    setHighlight(0);
    inputRef.current?.focus(); // mantem aberto e focado pra escolher mais de um seguido
  }

  function remove(value: string) {
    setSelected((prev) => prev.filter((v) => v !== value));
  }

  return (
    <div ref={rootRef} className="relative">
      <label className="mb-1 block text-xs font-medium text-slate-600">{label}</label>
      {selected.map((v) => (
        <input key={v} type="hidden" name={name} value={v} />
      ))}
      {selected.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {selected.map((v) => (
            <span key={v} className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
              {optionByValue.get(v)?.label ?? v}
              <button
                type="button"
                onClick={() => remove(v)}
                className="inline-flex items-center rounded-full hover:bg-blue-200"
                aria-label={`Remover ${optionByValue.get(v)?.label ?? v}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          autoComplete="off"
          placeholder={selected.length === 0 ? allLabel : "Adicionar…"}
          className={`${inputClass} pr-8`}
          value={text}
          onFocus={() => {
            setOpen(true);
            setHighlight(0);
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
              if (option) add(option);
            } else if (e.key === "Backspace" && text === "" && selected.length > 0) {
              remove(selected[selected.length - 1]); // apagar com campo vazio remove o ultimo chip
            } else if (e.key === "Escape") {
              setOpen(false);
              setText("");
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
              key={option.value}
              role="option"
              aria-selected={false}
              className={`cursor-pointer px-3 py-1.5 ${i === highlight ? "bg-blue-50 text-blue-800" : "text-slate-700"}`}
              onMouseEnter={() => setHighlight(i)}
              onMouseDown={(e) => {
                e.preventDefault(); // evita blur antes do click
                add(option);
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
