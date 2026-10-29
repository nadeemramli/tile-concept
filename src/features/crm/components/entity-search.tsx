"use client";

import { useEffect, useState, useId } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { searchProjectIdentitiesAction } from "@/server/commands/projects";
import { searchAccountsAction, searchContactsAction } from "@/server/commands/contacts";

interface Hit {
  id: string;
  name: string;
  customer_type?: string | null;
  account_type?: string | null;
}

/** Minimal async search input for picking an account or contact; emits a hidden input with the id. */
export function EntitySearch({ kind, name, label, defaultId, defaultName, onSelect, className, accountId, project = false }: { kind: "account" | "contact"; name: string; label?: string; defaultId?: string; defaultName?: string; onSelect?: (hit: Hit | null) => void; className?: string; accountId?: string; project?: boolean }) {
  const [q, setQ] = useState(defaultName ?? "");
  const [hits, setHits] = useState<Hit[]>([]);
  const [selected, setSelected] = useState<Hit | null>(defaultId ? { id: defaultId, name: defaultName ?? "" } : null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [error, setError] = useState("");
  const inputId = useId();
  const listId = `${inputId}-results`;
  function choose(hit: Hit) {
    setSelected(hit); setQ(hit.name); setOpen(false); onSelect?.(hit);
  }

  useEffect(() => {
    if (selected && q === selected.name) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      if (q.trim().length < 2 && !accountId) {
        setHits([]);
        return;
      }
      let res: Hit[];
      try { res = project ? await searchProjectIdentitiesAction(kind, q, accountId) : kind === "account" ? await searchAccountsAction(q) : await searchContactsAction(q, accountId); }
      catch { if (!cancelled) { setHits([]); setError("Search could not load. Try again."); } return; }
      if (cancelled) return;
      setError(""); setHits(res);
      setActive(0);
      setOpen(document.activeElement?.id === inputId);
    }, 200);
    return () => { cancelled = true; clearTimeout(t); };
  }, [q, kind, selected, accountId, inputId, project]);

  return (
    <div className={cn("relative", className)}>
      {label && <label htmlFor={inputId} className="mb-1.5 block text-xs font-medium">{label}</label>}
      <input type="hidden" name={name} value={selected?.id ?? ""} />
      <Input
        id={inputId}
        role="combobox"
        aria-expanded={open && hits.length > 0}
        aria-controls={listId}
        aria-activedescendant={open && hits[active] ? `${listId}-${active}` : undefined}
        aria-label={label ?? (kind === "account" ? "Company" : "Contact")}
        value={q}
        placeholder={kind === "account" ? "Company name or telephone…" : "Contact name or telephone…"}
        onChange={(e) => {
          setQ(e.target.value);
          setHits([]); setError(""); setOpen(false);
          setSelected(null);
          onSelect?.(null);
        }}
        onFocus={() => hits.length && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "Escape") { setOpen(false); return; }
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault(); setOpen(true);
            setActive((v) => Math.max(0, Math.min(hits.length - 1, v + (e.key === "ArrowDown" ? 1 : -1))));
          }
          if (e.key === "Enter" && open && hits[active]) { e.preventDefault(); choose(hits[active]); }
        }}
        aria-autocomplete="list"
      />
      {error && <p role="alert" className="mt-1 text-xs text-destructive">{error}</p>}
      {selected && <p className="mt-1 text-[11px] text-success">Selected: {selected.name}</p>}
      {open && hits.length > 0 && (
        <ul id={listId} className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-md border bg-popover p-1 text-sm shadow-md" role="listbox">
          {hits.map((h, index) => (
            <li key={h.id} id={`${listId}-${index}`} role="option" aria-selected={active === index}>
              <button
                type="button"
                tabIndex={-1}
                className={cn("flex w-full items-center justify-between rounded px-2 py-1.5 text-left hover:bg-accent", active === index && "bg-accent")}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(h)}
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
