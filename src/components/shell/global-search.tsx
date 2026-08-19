"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, Contact, FolderKanban, KanbanSquare, Package, Receipt, Search } from "lucide-react";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { globalSearchAction, type SearchHit } from "@/server/commands/search";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  contact: Contact,
  account: Building2,
  project: FolderKanban,
  opportunity: KanbanSquare,
  purchase: Receipt,
  product: Package,
};

const LABELS: Record<string, string> = {
  contact: "Contacts",
  account: "Accounts",
  project: "Projects",
  opportunity: "Opportunities",
  purchase: "Purchases",
  product: "Products",
};

export function GlobalSearch({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  const trimmed = query.trim();
  // Results are derived: below the minimum length we simply render nothing
  // rather than clearing state from inside the effect.
  const visibleHits = trimmed.length < 2 ? [] : hits;

  useEffect(() => {
    if (!open) return;
    const q = trimmed;
    if (q.length < 2) return;
    const t = setTimeout(() => {
      startTransition(async () => {
        const res = await globalSearchAction(q);
        setHits(res);
      });
    }, 180);
    return () => clearTimeout(t);
  }, [trimmed, open]);

  const groups = visibleHits.reduce<Record<string, SearchHit[]>>((acc, h) => {
    (acc[h.entity_type] ??= []).push(h);
    return acc;
  }, {});

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Global search" description="Search names, phones, emails, companies, projects, quote/order references and products" shouldFilter={false}>
      <CommandInput placeholder="Name, phone, email, company, project, ORC/quote number, product code…" value={query} onValueChange={setQuery} />
      <CommandList>
        <CommandEmpty>
          {trimmed.length < 2 ? "Type at least 2 characters." : pending ? "Searching…" : "No results. Phone numbers match on 4+ digits; product codes and aliases are searched too."}
        </CommandEmpty>
        {Object.entries(groups).map(([type, rows]) => {
          const Icon = ICONS[type] ?? Search;
          return (
            <CommandGroup key={type} heading={LABELS[type] ?? type}>
              {rows.map((h) => (
                <CommandItem
                  key={`${type}-${h.entity_id}-${h.subtitle}`}
                  value={`${type}-${h.entity_id}-${h.title}`}
                  onSelect={() => {
                    onOpenChange(false);
                    setQuery("");
                    router.push(h.href);
                  }}
                >
                  <Icon className="size-4" aria-hidden />
                  <span className="truncate">{h.title}</span>
                  {h.subtitle && <span className="ml-auto truncate text-xs text-muted-foreground">{h.subtitle}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          );
        })}
      </CommandList>
    </CommandDialog>
  );
}
