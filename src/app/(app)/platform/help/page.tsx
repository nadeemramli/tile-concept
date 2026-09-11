import type { Metadata } from "next";
import { Check } from "lucide-react";
import { requireSession } from "@/server/session";
import { PageBody, PageHeader } from "@/components/patterns/page-header";
import { StatusPill } from "@/components/patterns/status-pill";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { GLOSSARY, TERMS } from "@/lib/domain/glossary";
import { PERMISSIONS, PERMISSION_LABELS, ROLES, ROLE_LABELS, ROLE_PERMISSIONS, type PermissionKey } from "@/lib/rbac/matrix";

export const metadata: Metadata = { title: "Help & glossary" };

const VISIBLE_ROLES = ROLES.filter((r) => r !== "guest");

export default async function HelpPage() {
  const session = await requireSession();
  return (
    <PageBody className="max-w-5xl">
      <PageHeader
        title="Help & glossary"
        description="Every status and term in the app, with what it means and what it blocks or unlocks. The same wording appears in the tooltips, so this page can never disagree with what you see on screen."
      />

      <nav aria-label="Sections" className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {GLOSSARY.map((g) => (
          <a key={g.domain} href={`#${slug(g.domain)}`} className="text-info hover:underline">
            {g.domain}
          </a>
        ))}
        <a href="#terms" className="text-info hover:underline">
          Common terms
        </a>
        <a href="#who-can-do-what" className="text-info hover:underline">
          Who can do what
        </a>
      </nav>

      {GLOSSARY.map((group) => (
        <section key={group.domain} id={slug(group.domain)} className="scroll-mt-16 space-y-3">
          <h2 className="text-base font-semibold tracking-tight">{group.domain}</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {group.entries.map((entry) => (
              <Card key={entry.id} id={entry.id} className="scroll-mt-16 gap-2 px-4 py-3">
                <h3 className="text-sm font-medium">{entry.title}</h3>
                {entry.intro && <p className="text-xs text-muted-foreground">{entry.intro}</p>}
                {Object.keys(entry.map).length > 0 && (
                  <dl className="mt-1 space-y-2">
                    {Object.entries(entry.map).map(([key, m]) => (
                      <div key={key} className="grid grid-cols-[minmax(7rem,auto)_1fr] items-start gap-2">
                        <dt>
                          <StatusPill map={entry.map} value={key} hint={false} />
                        </dt>
                        <dd className="text-xs text-muted-foreground">{m.hint ?? "—"}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </Card>
            ))}
          </div>
        </section>
      ))}

      <section id="terms" className="scroll-mt-16 space-y-3">
        <h2 className="text-base font-semibold tracking-tight">Common terms</h2>
        <Card className="gap-0 px-4 py-1">
          <dl className="divide-y">
            {TERMS.map((t) => (
              <div key={t.id} id={t.id} className="scroll-mt-16 grid gap-1 py-2.5 sm:grid-cols-[14rem_1fr] sm:gap-4">
                <dt className="text-sm font-medium">{t.term}</dt>
                <dd className="text-xs text-muted-foreground">{t.meaning}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </section>

      <section id="who-can-do-what" className="scroll-mt-16 space-y-3">
        <h2 className="text-base font-semibold tracking-tight">Who can do what</h2>
        <p className="text-xs text-muted-foreground">
          Your role is <span className="font-medium text-foreground">{session.roleLabel}</span>. A tick means the role holds that permission. The database enforces this; the table only mirrors it. Ask an administrator if you need an action your role does not include.
        </p>
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-64">Action</TableHead>
                {VISIBLE_ROLES.map((r) => (
                  <TableHead key={r} className="whitespace-nowrap text-center text-[11px]">
                    {ROLE_LABELS[r]}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {PERMISSIONS.map((p: PermissionKey) => (
                <TableRow key={p}>
                  <TableCell className="py-1.5">
                    <span className="block text-sm">{PERMISSION_LABELS[p]}</span>
                    <span className="block font-mono text-[11px] text-muted-foreground">{p}</span>
                  </TableCell>
                  {VISIBLE_ROLES.map((r) => (
                    <TableCell key={r} className="py-1.5 text-center">
                      {ROLE_PERMISSIONS[r].includes(p) ? <Check className="mx-auto size-3.5 text-success" aria-label={`${ROLE_LABELS[r]} can`} /> : <span className="sr-only">{ROLE_LABELS[r]} cannot</span>}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
    </PageBody>
  );
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
