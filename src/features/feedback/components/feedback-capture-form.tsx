"use client";

import { useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Field } from "@/components/patterns/field";
import { DisabledHint } from "@/components/patterns/explain";
import { createFeedbackRequestAction } from "@/server/commands/feedback";
import { FEEDBACK_QUESTIONS } from "@/features/feedback/schema";
import type { FeedbackCreationResult, FeedbackPurchaseContext } from "@/features/feedback/types";
import { formatDateTime, formatMoney } from "@/lib/format";
import { FeedbackRequestControls } from "./feedback-request-controls";

export function FeedbackCaptureForm({ purchase }: { purchase: FeedbackPurchaseContext }) {
  const [pending, startTransition] = useTransition();
  const [whatsappConsent, setWhatsappConsent] = useState(false);
  const [photoPermission, setPhotoPermission] = useState(false);
  const [result, setResult] = useState<FeedbackCreationResult | null>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    formData.set("whatsapp_consent", whatsappConsent ? "on" : "");
    formData.set("photo_permission", photoPermission ? "on" : "");
    startTransition(async () => {
      const response = await createFeedbackRequestAction(formData);
      if (!response.ok) { toast.error(response.error); return; }
      setResult(response.data);
      toast.success(response.message);
    });
  }

  if (result || purchase.request) return <FeedbackRequestControls context={purchase} initialHandoff={result} photoPermission={result ? photoPermission : Boolean(purchase.request?.photo_permission)} />;

  return (
    <form className="space-y-5" onSubmit={submit}>
      <input type="hidden" name="purchase_id" value={purchase.purchase_id ?? ""} />
      <input type="hidden" name="visit_id" value={purchase.purchase_id ? "" : purchase.visit_id ?? ""} />
      <Card className="space-y-2 p-5">
        <p className="font-semibold">{purchase.customer_name}</p>
        <p className="text-sm text-muted-foreground">{purchase.purchase_ref ?? "Showroom visit"} · {formatDateTime(purchase.purchased_at)}{purchase.amount !== null ? ` · ${formatMoney(purchase.amount, purchase.currency ?? "MYR")}` : ""}</p>
        <p className="text-xs text-muted-foreground">{purchase.location_name ?? "Location not recorded"} · {purchase.salesperson_name ?? "Staff not recorded"}</p>
        <Link href={`/sales/contacts/${purchase.contact_id}`} className="text-sm text-info hover:underline">Open customer details</Link>
      </Card>
      <Alert><AlertTitle>1. Record their own experience</AlertTitle><AlertDescription>Ask the same questions for positive, mixed and critical experiences. Keep the customer’s words. A Google review is optional and no reward is offered for it.</AlertDescription></Alert>
      <Card className="space-y-5 p-5">
        {FEEDBACK_QUESTIONS.map((question, index) => <Field key={question.key} label={`${index + 1}. ${question.text}`} hint="Leave blank if skipped. At least two answers are needed for a useful draft."><Textarea id={`answer-${index}`} aria-label={question.text} name={`answer_${index}`} rows={3} maxLength={1000} placeholder="Customer’s answer…" /></Field>)}
      </Card>
      <Card className="space-y-4 p-5">
        <label className="flex items-start gap-3 text-sm"><Checkbox checked={whatsappConsent} onCheckedChange={(v) => setWhatsappConsent(v === true)} aria-label="Customer agreed to receive the WhatsApp link" /><span>Customer agreed to receive a private WhatsApp link containing their draft and optional photos.</span></label>
        <label className="flex items-start gap-3 text-sm"><Checkbox checked={photoPermission} onCheckedChange={(v) => setPhotoPermission(v === true)} aria-label="Customer media permission" /><span>Customer media permission: agreed to private photo storage and sharing through this link.<span className="mt-1 block text-xs text-muted-foreground">You can capture or upload photos in the next step. This does not authorize marketing use.</span></span></label>
      </Card>
      <div className="flex justify-end"><DisabledHint reason={!purchase.phone ? "Add a valid phone number to the customer and use a role that can reveal contacts." : undefined}><Button type="submit" size="lg" disabled={pending || !purchase.phone || !whatsappConsent}>{pending ? "Preparing…" : "Continue to photos & WhatsApp"}</Button></DisabledHint></div>
    </form>
  );
}