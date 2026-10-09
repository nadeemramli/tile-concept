"use client";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PageBody } from "@/components/patterns/page-header";
export default function CreativeError({ retry }: { retry: () => void }) {
  return <PageBody><section role="alert" className="space-y-3 rounded-lg border p-5"><h1 className="text-lg font-semibold">Creative workspace unavailable</h1><p className="text-sm text-muted-foreground">The latest work could not be loaded. Try again; your saved records remain in the workspace.</p><div className="flex flex-wrap gap-2"><Button onClick={retry}>Try again</Button><Button variant="outline" asChild><Link href="/marketing/creative">Clear filters</Link></Button><Button variant="ghost" asChild><Link href="/marketing/content-opportunities">Content Opportunities</Link></Button></div></section></PageBody>;
}
