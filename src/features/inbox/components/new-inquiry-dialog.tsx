"use client";

import { useState, useTransition } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { ClipboardPaste, Sparkles } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Field } from "@/components/patterns/field";
import { CandidateList } from "@/features/inbox/components/candidate-list";
import { extractFromText } from "@/lib/identity/normalize";
import { SOURCE_CHANNEL, statusMeta } from "@/lib/domain/status-maps";
import { createInquiryAction } from "@/server/commands/leads";
import { newInquirySchema, PRODUCT_INTERESTS, SOURCE_CHANNELS, type NewInquiryInput } from "@/features/inbox/schema";
import type { IdentityCandidate } from "@/features/inbox/types";
import type { ProfileRef } from "@/server/queries/reference";

const INTEREST_LABEL: Record<string, string> = { wall_panel: "Wall panel", tile: "Tile", cut_tile: "Cut tile", mosaic: "Mosaic", finishing: "Finishing", accessory: "Accessory" };

export function NewInquiryDialog({
  open,
  onOpenChange,
  members,
  locations,
  defaultLocationId,
  defaultOwnerId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  members: ProfileRef[];
  locations: { id: string; name: string }[];
  defaultLocationId: string | null;
  defaultOwnerId: string;
  onCreated: (leadId: string, suggestions: IdentityCandidate[]) => void;
}) {
  const [pending, start] = useTransition();
  const [pasted, setPasted] = useState("");
  const [result, setResult] = useState<{ leadId: string; suggestions: IdentityCandidate[] } | null>(null);
  const form = useForm<NewInquiryInput>({
    resolver: zodResolver(newInquirySchema),
    defaultValues: {
      source_channel: "whatsapp",
      source_detail: "",
      raw_name: "",
      raw_phone: "",
      raw_email: "",
      raw_company: "",
      interest: "",
      product_interest: [],
      location_id: defaultLocationId ?? "",
      owner_id: defaultOwnerId,
      notes: "",
      raw_text: "",
    },
  });

  function proposeFromPaste() {
    const ex = extractFromText(pasted);
    if (ex.name && !form.getValues("raw_name")) form.setValue("raw_name", ex.name, { shouldDirty: true });
    if (ex.phone && !form.getValues("raw_phone")) form.setValue("raw_phone", ex.phone, { shouldDirty: true });
    if (ex.email && !form.getValues("raw_email")) form.setValue("raw_email", ex.email, { shouldDirty: true });
    if (ex.company && !form.getValues("raw_company")) form.setValue("raw_company", ex.company, { shouldDirty: true });
    if (ex.message && !form.getValues("interest")) form.setValue("interest", ex.message.slice(0, 500), { shouldDirty: true });
    form.setValue("raw_text", pasted);
    toast.info("Fields proposed from the pasted text — review before saving.");
  }

  function submit(values: NewInquiryInput) {
    start(async () => {
      const res = await createInquiryAction(values);
      if (!res.ok) {
        toast.error(res.error);
        if (res.fieldErrors) {
          for (const [k, msgs] of Object.entries(res.fieldErrors)) form.setError(k as keyof NewInquiryInput, { message: msgs[0] });
        }
        return;
      }
      toast.success(res.message);
      setResult({ leadId: res.data.lead_id, suggestions: res.data.suggestions });
      onCreated(res.data.lead_id, res.data.suggestions);
    });
  }

  function close(o: boolean) {
    if (!o) {
      form.reset();
      setPasted("");
      setResult(null);
    }
    onOpenChange(o);
  }

  const err = form.formState.errors;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New inquiry</DialogTitle>
          <DialogDescription>Capture once. Identity is resolved afterwards — nothing is merged automatically.</DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-3">
            <p className="text-sm">
              Inquiry saved. {result.suggestions.length > 0 ? "Possible existing records were found — link one from the lead drawer, or create a new contact." : "No matching contact or account exists yet."}
            </p>
            <CandidateList candidates={result.suggestions} />
            <DialogFooter>
              <Button onClick={() => close(false)}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={form.handleSubmit(submit)} className="space-y-4">
            <div className="rounded-md border bg-muted/30 p-3">
              <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium">
                <ClipboardPaste className="size-3.5" aria-hidden /> Paste a DM, WhatsApp message or form submission
              </div>
              <Textarea value={pasted} onChange={(e) => setPasted(e.target.value)} rows={3} placeholder="Hi, my name is … I'm interested in wall panels for my living room. Call me 012-…" className="text-sm" />
              <Button type="button" size="sm" variant="outline" className="mt-2 h-7" disabled={!pasted.trim()} onClick={proposeFromPaste}>
                <Sparkles className="size-3.5" aria-hidden /> Propose fields
              </Button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Source channel" required error={err.source_channel?.message}>
                <Controller
                  control={form.control}
                  name="source_channel"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {SOURCE_CHANNELS.map((c) => <SelectItem key={c} value={c}>{statusMeta(SOURCE_CHANNEL, c).label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>
              <Field label="Source detail" hint="Campaign / form / page / referrer" error={err.source_detail?.message}>
                <Input className="h-8" {...form.register("source_detail")} />
              </Field>
              <Field label="Name" error={err.raw_name?.message}>
                <Input className="h-8" autoComplete="off" {...form.register("raw_name")} />
              </Field>
              <Field label="Phone" error={err.raw_phone?.message} hint="Stored raw and normalized (E.164)">
                <Input className="h-8 font-mono" inputMode="tel" {...form.register("raw_phone")} />
              </Field>
              <Field label="Email" error={err.raw_email?.message}>
                <Input className="h-8" type="email" {...form.register("raw_email")} />
              </Field>
              <Field label="Company" error={err.raw_company?.message}>
                <Input className="h-8" {...form.register("raw_company")} />
              </Field>
              <Field label="Location" error={err.location_id?.message}>
                <Controller
                  control={form.control}
                  name="location_id"
                  render={({ field }) => (
                    <Select value={field.value || "none"} onValueChange={(v) => field.onChange(v === "none" ? "" : v)}>
                      <SelectTrigger className="h-8"><SelectValue placeholder="Location" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Unspecified</SelectItem>
                        {locations.map((l) => <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>
              <Field label="Owner" error={err.owner_id?.message}>
                <Controller
                  control={form.control}
                  name="owner_id"
                  render={({ field }) => (
                    <Select value={field.value || "none"} onValueChange={(v) => field.onChange(v === "none" ? "" : v)}>
                      <SelectTrigger className="h-8"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Unassigned</SelectItem>
                        {members.map((m) => <SelectItem key={m.user_id} value={m.user_id}>{m.full_name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>
            </div>

            <Field label="Product interest">
              <Controller
                control={form.control}
                name="product_interest"
                render={({ field }) => (
                  <ToggleGroup type="multiple" value={field.value} onValueChange={field.onChange} variant="outline" size="sm" className="flex-wrap justify-start">
                    {PRODUCT_INTERESTS.map((p) => <ToggleGroupItem key={p} value={p} className="h-7 px-2 text-xs">{INTEREST_LABEL[p]}</ToggleGroupItem>)}
                  </ToggleGroup>
                )}
              />
            </Field>
            <Field label="Interest / message" error={err.interest?.message}>
              <Textarea rows={2} {...form.register("interest")} />
            </Field>
            <Field label="Internal notes" error={err.notes?.message}>
              <Textarea rows={2} {...form.register("notes")} />
            </Field>

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => close(false)}>Cancel</Button>
              <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save inquiry"}</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
