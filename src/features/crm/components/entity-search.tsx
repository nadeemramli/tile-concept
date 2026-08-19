"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { searchAccountsAction, searchContactsAction } from "@/server/commands/contacts";

interface Hit {
  id: string;
  name: string;
  customer_type?: string | null;
  account_type?: string | null;
}

/** Minimal async search input for picking an account or contact; emits a hidden input with the id. */
export function EntitySearch({ kind, name, label, defaultId, defaultName, onSelect, className }: { kind: "account" | "contact"; name: string; label?: string; defaultId?: string; defaultName?: string; onSelect?: (hit: Hit | null) => void; className?: string }) {
  const [q, setQ] = useState(defaultName ?? "");
  const [hits, setHits] = useState<Hit[]>([]);
  const [selected, setSelected] = useState<Hit | null>(defaultId ? { id: defaultId, name: defaultName ?? "" } : null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (selected && q === selected.name) return;
    const t = setTimeout(async () => {
      if (q.trim().length < 1) {
        setHits([]);
        return;
      }
      const res = kind === "account" ? await searchAccountsAction(q) : await searchContactsAction(q);
      setHits(res);
      setOpen(true);
    }, 200);
    return () => clearTimeout(t);
  }, [q, kind, selected]);

  return (
    <div className={cn("relative", className)}>
      {label && <label className="mb-1.5 block text-xs font-medium">{label}</label>}
      <input type="hidden" name={name} value={selected?.id ?? ""} />
      <Input
        value={q}
        placeholder={kind === "account" ? "Search accounts…" : "Search contacts…"}
        onChange={(e) => {
          setQ(e.target.value);
          setSelected(null);
          onSelect?.(null);
        }}
        onFocus={() => hits.length && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        aria-autocomplete="list"
      />
      {selected && <p className="mt-1 text-[11px] text-success">Selected: {selected.name}</p>}
      {open && hits.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-md border bg-popover p-1 text-sm shadow-md" role="listbox">
          {hits.map((h) => (
            <li key={h.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left hover:bg-accent"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setSelected(h);
                  setQ(h.name);
                  setOpen(false);
                  onSelect?.(h);
                }}
              >
                <span className="truncate">{h.name}</span>
                <span className="ml-2 text-xs text-muted-foreground">{h.customer_type ?? h.account_type ?? ""}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
