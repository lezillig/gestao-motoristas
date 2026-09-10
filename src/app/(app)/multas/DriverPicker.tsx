"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { inputClass } from "@/lib/ui";

function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

type DriverOption = { id: string; name: string };

// Combobox de motorista com busca — so renderiza a lista de opcoes quando
// aberto, ao contrario de um <select> nativo (que precisa de TODAS as
// <option> no DOM o tempo todo, mesmo fechado). Com ~170 motoristas ativos
// e uma linha por multa (500+ multas numa empresa real), o <select> nativo
// que existia aqui antes gerava ~190 mil nos de DOM na pagina inteira,
// deixando a tela lenta/travada pra qualquer interacao (confirmado real
// 2026-09-10). Mesmo padrao visual/UX de ComboboxFilter.tsx, mas com
// callback direto (onSelect) em vez de <input type="hidden"> de formulario
// — aqui a escolha dispara uma Server Action na hora, nao um GET de filtro.
export default function DriverPicker({
  drivers,
  selectedId,
  onSelect,
  disabled,
}: {
  drivers: DriverOption[];
  selectedId: string | null;
  onSelect: (driverId: string) => void;
  disabled?: boolean;
}) {
  const selectedLabel = drivers.find((d) => d.id === selectedId)?.name ?? "";
  const [text, setText] = useState(selectedLabel);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  // Ajusta `text` quando `selectedLabel` muda (motorista trocado por fora,
  // ex. resolucao automatica de outra sincronizacao) sem useEffect — ajustar
  // estado durante a renderizacao e o jeito recomendado pra "resetar estado
  // quando uma prop muda", evita o ciclo extra de render+commit de um efeito.
  const [prevSelectedLabel, setPrevSelectedLabel] = useState(selectedLabel);
  if (selectedLabel !== prevSelectedLabel) {
    setPrevSelectedLabel(selectedLabel);
    setText(selectedLabel);
  }

  const filtered = useMemo(() => {
    const q = normalize(text.trim());
    if (!q || text === selectedLabel) return drivers;
    return drivers.filter((d) => normalize(d.name).includes(q));
  }, [text, drivers, selectedLabel]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setText(selectedLabel);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [selectedLabel]);

  function choose(d: DriverOption) {
    setText(d.name);
    setOpen(false);
    onSelect(d.id);
  }

  return (
    <div ref={rootRef} className="relative">
      <div className="relative">
        <input
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          autoComplete="off"
          disabled={disabled}
          placeholder="Selecionar motorista..."
          className={`${inputClass} py-1 pr-6 text-xs disabled:opacity-60`}
          value={text}
          onFocus={(e) => {
            setOpen(true);
            setHighlight(0);
            e.target.select();
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
              setText(selectedLabel);
            }
          }}
        />
        <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-400" />
      </div>
      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-10 mt-1 max-h-48 w-56 overflow-auto rounded-lg border border-slate-200 bg-white py-1 text-xs shadow-lg"
        >
          {filtered.length === 0 && <li className="px-3 py-1.5 text-slate-400">Nenhum resultado</li>}
          {filtered.map((d, i) => (
            <li
              key={d.id}
              role="option"
              aria-selected={d.id === selectedId}
              className={`cursor-pointer px-3 py-1.5 ${i === highlight ? "bg-blue-50 text-blue-800" : "text-slate-700"}`}
              onMouseEnter={() => setHighlight(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(d);
              }}
            >
              {d.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
