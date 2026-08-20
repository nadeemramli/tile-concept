"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, FileUp, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/patterns/field";
import { SimpleSelect } from "@/features/catalog/components/selects";
import { TonePill } from "@/components/patterns/status-pill";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { useSession } from "@/components/shell/session-context";
import { classifySource } from "@/lib/parsers";
import { formatBytes } from "@/features/sources/status-maps";
import { parseSourceAssetAction, registerSourceAssetAction } from "@/server/commands/sources";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Phase = "idle" | "hashing" | "uploading" | "registering" | "parsing" | "done" | "duplicate" | "error";

const PHASE_LABEL: Record<Phase, string> = {
  idle: "",
  hashing: "Fingerprinting the file…",
  uploading: "Uploading to private storage…",
  registering: "Registering the source…",
  parsing: "Reading the document…",
  done: "Done",
  duplicate: "Already imported",
  error: "Failed",
};

async function sha256(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function UploadDialog({ open, onOpenChange, suppliers, brands }: { open: boolean; onOpenChange: (o: boolean) => void; suppliers: { id: string; name: string }[]; brands: { id: string; name: string }[] }) {
  const { session } = useSession();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [supplierId, setSupplierId] = useState("");
  const [brandId, setBrandId] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [existingId, setExistingId] = useState<string | null>(null);
  const [summary, setSummary] = useState<{ records: number; review_items: number; duplicates: number; note?: string } | null>(null);

  const busy = ["hashing", "uploading", "registering", "parsing"].includes(phase);

  function reset() {
    setFile(null);
    setPhase("idle");
    setMessage(null);
    setExistingId(null);
    setSummary(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function submit() {
    if (!file) return;
    setMessage(null);
    setExistingId(null);
    setSummary(null);
    try {
      setPhase("hashing");
      const checksum = await sha256(file);
      const kind = classifySource(file.name, file.type);
      // Bucket policy expects the workspace id as the leading folder.
      const path = `${session.workspaceId}/${checksum}-${file.name.replace(/[^\w.\-]+/g, "_")}`;

      setPhase("uploading");
      const supabase = getBrowserSupabase();
      const { error: upErr } = await supabase.storage.from("source-assets").upload(path, file, { upsert: true, contentType: file.type || undefined });
      if (upErr) {
        setPhase("error");
        setMessage(upErr.message);
        return;
      }

      setPhase("registering");
      const reg = await registerSourceAssetAction({
        name: file.name,
        kind,
        checksum,
        storage_path: path,
        mime_type: file.type || undefined,
        size_bytes: file.size,
        supplier_id: supplierId || undefined,
        brand_id: brandId || undefined,
      });
      if (!reg.ok) {
        setPhase("error");
        setMessage(reg.error);
        return;
      }
      if (reg.data.reused) {
        // Idempotency is the feature: no second asset, no second job.
        setPhase("duplicate");
        setExistingId(reg.data.id);
        router.refresh();
        return;
      }

      setPhase("parsing");
      const parsed = await parseSourceAssetAction({ asset_id: reg.data.id });
      if (!parsed.ok) {
        setPhase("error");
        setMessage(parsed.error);
        setExistingId(reg.data.id);
        router.refresh();
        return;
      }
      setPhase("done");
      setSummary(parsed.data);
      setExistingId(reg.data.id);
      toast.success(parsed.message ?? "Imported");
      router.refresh();
    } catch (e) {
      setPhase("error");
      setMessage(e instanceof Error ? e.message : "The upload failed");
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a source document</DialogTitle>
          <DialogDescription>
            PDF, image, Excel or CSV. The original is stored privately and fingerprinted, so importing the same file twice changes nothing.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <Field label="File" htmlFor="source-file" required hint="Native text and spreadsheet cells are read directly. Scanned pages are queued for manual entry.">
            <Input
              id="source-file"
              ref={inputRef}
              type="file"
              accept=".pdf,.xlsx,.xls,.csv,.png,.jpg,.jpeg,.webp"
              disabled={busy}
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setPhase("idle");
                setMessage(null);
              }}
            />
          </Field>
          {file && (
            <p className="text-[11px] text-muted-foreground">
              {file.name} · {formatBytes(file.size)} · detected as {classifySource(file.name, file.type)}
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Supplier" hint="Sets the default price list on approval.">
              <SimpleSelect value={supplierId} onChange={setSupplierId} options={suppliers.map((s) => ({ value: s.id, label: s.name }))} placeholder="Not specified" disabled={busy} />
            </Field>
            <Field label="Brand">
              <SimpleSelect value={brandId} onChange={setBrandId} options={brands.map((b) => ({ value: b.id, label: b.name }))} placeholder="Not specified" disabled={busy} />
            </Field>
          </div>

          {busy && (
            <p className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
              {PHASE_LABEL[phase]}
            </p>
          )}

          {phase === "duplicate" && (
            <div className="space-y-2 rounded-md border border-info/30 bg-info/10 px-3 py-2 text-sm">
              <p className="flex items-center gap-2 font-medium text-info">
                <CheckCircle2 className="size-4" aria-hidden /> This exact file is already in the library
              </p>
              <p className="text-muted-foreground">
                The content fingerprint matches an existing source, so nothing was re-imported and no new review items were created.
              </p>
              {existingId && (
                <Button asChild size="sm" variant="outline" onClick={() => onOpenChange(false)}>
                  <Link href={`/sources/library?asset=${existingId}`}>Open the existing source</Link>
                </Button>
              )}
            </div>
          )}

          {phase === "done" && summary && (
            <div className="space-y-2 rounded-md border border-success/30 bg-success/10 px-3 py-2 text-sm">
              <p className="flex items-center gap-2 font-medium text-success">
                <CheckCircle2 className="size-4" aria-hidden /> Extracted {summary.records} row(s)
              </p>
              <div className="flex flex-wrap gap-1.5">
                <TonePill tone="warning" label={`${summary.review_items} to review`} />
                {summary.duplicates > 0 && <TonePill tone="info" label={`${summary.duplicates} existing code(s)`} />}
                {summary.note && <TonePill tone="destructive" label={summary.note} />}
              </div>
              <p className="text-muted-foreground">Nothing has been published — every row waits in the review queue.</p>
              <Button asChild size="sm" onClick={() => onOpenChange(false)}>
                <Link href="/sources/review">Open the review queue</Link>
              </Button>
            </div>
          )}

          {phase === "error" && message && (
            <p className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              {message}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {phase === "done" || phase === "duplicate" ? "Close" : "Cancel"}
          </Button>
          {phase !== "done" && phase !== "duplicate" && (
            <Button onClick={submit} disabled={!file || busy}>
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <FileUp className="size-4" aria-hidden />}
              Upload and read
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function UploadButton({ suppliers, brands, className }: { suppliers: { id: string; name: string }[]; brands: { id: string; name: string }[]; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" className={cn("h-8", className)} onClick={() => setOpen(true)}>
        <Upload className="size-3.5" aria-hidden /> Add source
      </Button>
      <UploadDialog open={open} onOpenChange={setOpen} suppliers={suppliers} brands={brands} />
    </>
  );
}
