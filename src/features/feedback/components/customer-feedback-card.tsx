"use client";

import Image from "next/image";
import { useState, useTransition } from "react";
import { Check, Copy, Download, ExternalLink, MessageSquareText, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { confirmCustomerFeedbackAction } from "@/server/commands/feedback";
import type { CustomerFeedbackView } from "@/features/feedback/types";

export function CustomerFeedbackCard({ token, feedback }: { token: string; feedback: CustomerFeedbackView }) {
  const [draft, setDraft] = useState(feedback.draft_text);
  const [confirmed, setConfirmed] = useState(feedback.status === "confirmed");
  const [pending, startTransition] = useTransition();

  function confirm() {
    startTransition(async () => {
      const result = await confirmCustomerFeedbackAction({ token, customer_text: draft });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setConfirmed(true);
      toast.success(result.message);
    });
  }

  async function copyDraft() {
    await navigator.clipboard.writeText(draft);
    toast.success("Draft copied. You can edit it again inside Google.");
  }

  return (
    <Card className="mx-auto w-full max-w-2xl space-y-6 p-5 sm:p-7">
      <div className="space-y-2">
        <div className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary"><MessageSquareText className="size-5" aria-hidden /></div>
        <h1 className="text-xl font-semibold">Check your feedback, {feedback.customer_name}</h1>
        <p className="text-sm text-muted-foreground">We wrote down what you shared after your Tile Concept visit{feedback.location_name ? ` at ${feedback.location_name}` : ""}. Please correct anything that does not sound like you.</p>
      </div>

      <Alert>
        <ShieldCheck className="size-4" aria-hidden />
        <AlertTitle>You control what happens next</AlertTitle>
        <AlertDescription>Your private feedback is separate from Google. Leaving a Google review is optional and does not affect your purchase or any private-feedback benefit.</AlertDescription>
      </Alert>

      <div className="space-y-3">
        <h2 className="text-sm font-semibold">What we recorded</h2>
        <dl className="space-y-3">
          {feedback.answers.map((answer) => (
            <div key={answer.question_key} className="rounded-lg border bg-muted/20 p-3">
              <dt className="text-xs font-medium text-muted-foreground">{answer.question_text}</dt>
              <dd className="mt-1 text-sm">{answer.answer_text || "Skipped"}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="space-y-2">
        <label htmlFor="customer-review-draft" className="text-sm font-semibold">Optional review draft</label>
        <p className="text-xs text-muted-foreground">Edit freely. This is only a writing aid based on the answers above; Tile Concept cannot submit it for you.</p>
        <Textarea id="customer-review-draft" rows={7} value={draft} maxLength={2000} onChange={(event) => { setDraft(event.target.value); setConfirmed(false); }} />
        <div className="text-right text-xs text-muted-foreground">{draft.length}/2000</div>
      </div>

      {feedback.has_photo ? (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold">Your optional photo</h2>
          <div className="overflow-hidden rounded-lg border bg-muted/20">
            <Image src={`/review/${encodeURIComponent(token)}/photo`} alt="Photo captured with the customer's permission" width={1200} height={800} sizes="(max-width: 672px) 100vw, 620px" unoptimized className="max-h-80 w-full object-contain" />
          </div>
          <Button asChild size="sm" variant="outline"><a href={`/review/${encodeURIComponent(token)}/photo?download=1`}><Download className="size-4" aria-hidden /> Save photo for manual upload</a></Button>
        </div>
      ) : null}

      <div className="space-y-3 border-t pt-5">
        <Button className="w-full" size="lg" onClick={confirm} disabled={pending || draft.trim().length < 5}>{confirmed ? <><Check className="size-4" aria-hidden /> Private feedback confirmed</> : pending ? "Confirming…" : "Confirm private feedback"}</Button>
        <p className="text-center text-xs text-muted-foreground">You can stop here. Nothing else is required.</p>
      </div>

      {confirmed ? (
        <div className="space-y-3 rounded-lg border border-primary/20 bg-primary/5 p-4">
          <h2 className="font-semibold">Optional: share an honest Google review</h2>
          <p className="text-sm text-muted-foreground">Google does not let this app prefill or submit the review. Copy your draft, then choose the rating, edit the text, and attach any photo yourself in Google.</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button variant="outline" onClick={copyDraft}><Copy className="size-4" aria-hidden /> Copy my draft</Button>
            {feedback.review_url ? <Button asChild><a href={`/review/${encodeURIComponent(token)}/google`} target="_blank" rel="noreferrer">Open Google <ExternalLink className="size-4" aria-hidden /></a></Button> : <Button disabled>Google link not configured</Button>}
          </div>
        </div>
      ) : null}
    </Card>
  );
}

