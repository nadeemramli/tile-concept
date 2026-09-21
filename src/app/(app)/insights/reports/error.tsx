"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PageBody } from "@/components/patterns/page-header";

export default function ReportsError({ reset }: { reset: () => void }) {
  return (
    <PageBody>
      <section className="rounded-xl border bg-card p-5" role="alert">
        <h1 className="text-lg font-semibold">Report unavailable</h1>
        <p className="mt-2 text-sm text-muted-foreground">We couldn’t retrieve this report. Try again or return to the reports list.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={reset}>Try again</Button>
          <Button variant="outline" asChild><Link href="/insights/reports">All reports</Link></Button>
        </div>
      </section>
    </PageBody>
  );
}
