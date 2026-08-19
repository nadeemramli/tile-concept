import Link from "next/link";
import { ArrowRight, Cable, ListChecks } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageBody, PageHeader } from "@/components/patterns/page-header";
import { ROUTES } from "@/lib/nav/routes";

/** "Next module" pages explain the future workflow and what unlocks it — never a blank page. */
export function NextModulePage({ routeKey, children }: { routeKey: string; children?: React.ReactNode }) {
  const route = ROUTES.find((r) => r.key === routeKey);
  if (!route?.nextModule) return null;
  const { phase, summary, workflow, unlocks } = route.nextModule;

  return (
    <PageBody className="max-w-3xl">
      <PageHeader title={route.label} description={summary}>
        <Badge variant="outline" className="text-muted-foreground">
          {phase} — schema ready, UI not yet built
        </Badge>
      </PageHeader>
      {children}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <ListChecks className="size-4 text-info" aria-hidden />
            Intended workflow
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-2.5">
            {workflow.map((step, i) => (
              <li key={i} className="flex gap-3 text-sm">
                <span className="tnum mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-secondary text-[11px] font-medium">{i + 1}</span>
                <span className="text-muted-foreground">{step}</span>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Cable className="size-4 text-ai" aria-hidden />
            What unlocks this module
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2">
            {unlocks.map((u, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                <ArrowRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/60" aria-hidden />
                {u}
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-muted-foreground">
            Connector status lives in{" "}
            <Link href="/platform/integrations" className="text-info underline-offset-2 hover:underline">
              Integrations
            </Link>
            . The product decisions behind this module are in <code className="font-mono">docs/prd</code>.
          </p>
        </CardContent>
      </Card>
    </PageBody>
  );
}
