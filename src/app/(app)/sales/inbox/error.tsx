"use client";

import { Button } from "@/components/ui/button";

export default function InboxError({ reset }: { reset: () => void }) {
  return (
    <div className="m-6 rounded-lg border p-6" role="alert">
      <h2 className="font-semibold">The Inquiry Inbox could not load</h2>
      <p className="mt-2 text-sm text-muted-foreground">Your inquiries have not been removed. Retry to load the latest leads and follow-ups.</p>
      <Button className="mt-4" onClick={reset}>Retry inbox</Button>
    </div>
  );
}
