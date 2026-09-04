"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Check, Copy, ExternalLink, ImagePlus, MessageCircle, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Field } from "@/components/patterns/field";
import { TonePill } from "@/components/patterns/status-pill";
import { createFeedbackRequestAction, logFeedbackWhatsAppOpenedAction } from "@/server/commands/feedback";
import { FEEDBACK_QUESTIONS } from "@/features/feedback/schema";
import type { FeedbackCreationResult, FeedbackPurchaseContext } from "@/features/feedback/types";
import { formatDateTime, formatMoney } from "@/lib/format";

export function FeedbackCaptureForm({ purchase }: { purchase: FeedbackPurchaseContext }) {
  const [pending, startTransition] = useTransition();
  const [whatsappConsent, setWhatsappConsent] = useState(false);
  const [photoPermission, setPhotoPermission] = useState(false);
  const [benefitGranted, setBenefitGranted] = useState(false);
  const [result, setResult] = useState<FeedbackCreationResult | null>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    formData.set("whatsapp_consent", whatsappConsent ? "on" : "");
    formData.set("photo_permission", photoPermission ? "on" : "");
    formData.set("benefit_granted", benefitGranted ? "on" : "");
    startTransition(async () => {
      const response = await createFeedbackRequestAction(formData);
      if (!response.ok) {
        toast.error(response.error);
        return;
      }
      setResult(response.data);
      toast.success(response.message);
      if (response.data.photo_warning) toast.warning(response.data.photo_warning);
    });
  }

  async function openWhatsApp() {
    if (!result) return;
    const response = await logFeedbackWhatsAppOpenedAction(result.request_id);
    if (!response.ok) toast.warning("WhatsApp will open, but the handoff event could not be logged.");
    window.open(result.whatsapp_url, "_blank", "noopener,noreferrer");
  }

  async function copyLink() {
    if (!result) return;
    await navigator.clipboard.writeText(result.secure_link);
    toast.success("Private link copied.");
  }

  if (result) {
    return (
      <Card className="space-y-5 p-5">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-success/15 text-success"><Check className="size-5" aria-hidden /></span>
          <div>
            <h2 className="font-semibold">Feedback handoff prepared</h2>
            <p className="mt-1 text-sm text-muted-foreground">The customer will confirm or edit their own draft. Google remains optional and customer-controlled.</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <TonePill tone={result.generation_mode === "llm" ? "ai" : "neutral"} label={result.generation_mode === "llm" ? "LLM-assisted draft" : "Deterministic fallback"} size="md" />
          <TonePill tone="success" label="Private link expires in 7 days" size="md" />
        </div>
        {result.photo_warning ? <Alert className="border-warning/40 bg-warning/5"><AlertTitle>Photo not attached</AlertTitle><AlertDescription>{result.photo_warning}</AlertDescription></Alert> : null}
        <div className="rounded-lg border bg-muted/25 p-3 font-mono text-xs break-all">{result.secure_link}</div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={openWhatsApp}><MessageCircle className="size-4" aria-hidden /> Open WhatsApp</Button>
          <Button variant="outline" onClick={copyLink}><Copy className="size-4" aria-hidden /> Copy private link</Button>
          <Button asChild variant="outline"><a href="/sales/feedback">Open feedback tracking <ExternalLink className="size-4" aria-hidden /></a></Button>
        </div>
      </Card>
    );
  }

  if (purchase.existing_request_id) {
    return (
      <Alert className="border-warning/40 bg-warning/5">
        <AlertTitle>Feedback already prepared</AlertTitle>
        <AlertDescription className="space-y-3">
          <p>This purchase already has a feedback request. Its private token cannot be displayed again after creation.</p>
          <Button asChild variant="outline" size="sm"><a href="/sales/feedback">Open feedback tracking</a></Button>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <form className="space-y-5" onSubmit={submit}>
      <input type="hidden" name="purchase_id" value={purchase.purchase_id} />
      <Card className="space-y-3 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">{purchase.customer_name}</p>
            <p className="mt-1 text-xs text-muted-foreground">{purchase.purchase_ref ?? "Purchase"} · {formatDateTime(purchase.purchased_at)} · {formatMoney(purchase.amount, purchase.currency)}</p>
          </div>
          <TonePill tone={purchase.phone ? "success" : "destructive"} label={purchase.phone ? "WhatsApp ready" : "Phone unavailable"} size="md" />
        </div>
        <p className="text-xs text-muted-foreground">{purchase.location_name ?? "Location not recorded"} · {purchase.salesperson_name ?? "Salesperson not recorded"}</p>
      </Card>

      <Alert>
        <ShieldCheck className="size-4" aria-hidden />
        <AlertTitle>Private feedback first</AlertTitle>
        <AlertDescription>Record the customer’s words without steering the answer. The same optional Google handoff is available for positive, mixed, or critical feedback.</AlertDescription>
      </Alert>

      <Card className="space-y-5 p-5">
        {FEEDBACK_QUESTIONS.map((question, index) => (
          <Field key={question.key} label={`${index + 1}. ${question.text}`} hint="Record substantially verbatim; leave blank only if the customer skips it.">
            <Textarea name={`answer_${index}`} rows={3} maxLength={1000} placeholder="Customer’s answer…" />
          </Field>
        ))}
      </Card>

      <Card className="space-y-4 p-5">
        <label className="flex items-start gap-3 text-sm">
          <Checkbox checked={whatsappConsent} onCheckedChange={(value) => setWhatsappConsent(Boolean(value))} aria-label="Customer agreed to receive the WhatsApp link" />
          <span><span className="font-medium">Customer agreed to receive the private link by WhatsApp</span><span className="mt-1 block text-xs text-muted-foreground">The message states that a Google review is optional.</span></span>
        </label>
        <label className="flex items-start gap-3 text-sm">
          <Checkbox checked={photoPermission} onCheckedChange={(value) => setPhotoPermission(Boolean(value))} aria-label="Customer granted photo permission" />
          <span><span className="font-medium">Customer granted private photo storage and download permission</span><span className="mt-1 block text-xs text-muted-foreground">The app cannot attach the photo to Google; the customer may save and upload it themselves.</span></span>
        </label>
        <Field label="Optional photo" hint="JPEG, PNG, or WebP · up to 10 MB">
          <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground hover:bg-muted/40">
            <ImagePlus className="size-4" aria-hidden />
            <Input name="photo" type="file" accept="image/jpeg,image/png,image/webp" disabled={!photoPermission} className="h-auto border-0 p-0 file:mr-3 file:rounded file:border-0 file:bg-muted file:px-2 file:py-1 file:text-xs" />
          </label>
        </Field>
      </Card>

      <Card className="space-y-4 p-5">
        <label className="flex items-start gap-3 text-sm">
          <Checkbox checked={benefitGranted} onCheckedChange={(value) => setBenefitGranted(Boolean(value))} aria-label="Private feedback benefit granted" />
          <span><span className="font-medium">Approved benefit granted for private feedback only</span><span className="mt-1 block text-xs text-muted-foreground">It remains earned if the customer declines Google, leaves criticism, or later changes/removes a review.</span></span>
        </label>
        {benefitGranted ? <Field label="Benefit policy/reference" required hint="Record the approved reference; this module does not calculate or apply a discount."><Input name="benefit_reference" maxLength={200} placeholder="e.g. approved receipt/policy reference" /></Field> : <input type="hidden" name="benefit_reference" value="" />}
      </Card>

      <div className="flex justify-end">
        <Button type="submit" size="lg" disabled={pending || !purchase.phone}>{pending ? "Preparing…" : "Prepare private WhatsApp link"}</Button>
      </div>
    </form>
  );
}
