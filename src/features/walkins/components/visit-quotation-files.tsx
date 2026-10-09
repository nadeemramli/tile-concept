"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DisabledHint, gateReason } from "@/components/patterns/explain";
import { Input } from "@/components/ui/input";
import { downloadVisitQuotationAction, finishVisitQuotationAction, listVisitQuotationsAction } from "@/server/commands/visit-quotations";
import { QUOTATION_ACCEPT, quotationFileError, type QueuedQuotation, type QuotationFile } from "../quotation-files";
import { uploadQuotation } from "../upload-quotation";
import { QuotationFilePicker } from "./quotation-file-picker";

export function VisitQuotationFiles({ visitId, canWrite, initialFiles = [], onPendingChange }: {
  visitId: string; canWrite: boolean; initialFiles?: QueuedQuotation[]; onPendingChange?: (pending: boolean) => void;
}) {
  const [queued, setQueued] = useState(initialFiles);
  const [files, setFiles] = useState<QuotationFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const lock = useRef(false);
  const autoStarted = useRef(false);

  useEffect(() => {
    let active = true;
    listVisitQuotationsAction(visitId).then((r) => {
      if (!active) return;
      if (r.ok) { setFiles(r.data); setListError(""); }
      else setListError(r.error);
      setLoading(false);
    }).catch(() => { if (active) { setListError("Could not load quotation files."); setLoading(false); } });
    return () => { active = false; };
  }, [visitId, revision]);

  useEffect(() => { onPendingChange?.(busy || queued.length > 0); }, [busy, queued.length, onPendingChange]);

  async function upload(items: QueuedQuotation[]) {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    try {
      for (const item of items) {
        try {
          await uploadQuotation(visitId, item);
          setQueued((current) => current.filter((q) => q.id !== item.id));
          setErrors((current) => { const next = { ...current }; delete next[item.id]; return next; });
        } catch (e) {
          setErrors((current) => ({ ...current, [item.id]: e instanceof Error ? e.message : "Upload failed. Retry this file." }));
        }
      }
    } finally {
      lock.current = false; setBusy(false); setRevision((r) => r + 1);
    }
  }

  useEffect(() => {
    if (!autoStarted.current && initialFiles.length) {
      autoStarted.current = true;
      void upload(initialFiles);
    }
    // Initial wizard attachments are submitted once; subsequent attempts are explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function download(id: string) {
    try {
      const r = await downloadVisitQuotationAction(id);
      if (!r.ok) { toast.error(r.error); return; }
      const link = document.createElement("a");
      link.href = r.data; link.rel = "noopener"; document.body.appendChild(link); link.click(); link.remove();
    } catch { toast.error("Could not download quotation. Please retry."); }
  }

  async function recover(id: string) {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    try {
      const r = await finishVisitQuotationAction(visitId, id);
      if (!r.ok) toast.error(r.error);
      else setRevision((n) => n + 1);
    } catch { toast.error("Could not check the upload. Please retry."); }
    finally { lock.current = false; setBusy(false); }
  }

  return <div className="min-w-0 space-y-3">
    {loading && <p role="status" className="text-sm text-muted-foreground">Loading quotation files…</p>}
    {listError && <div role="alert" className="text-sm">{listError} <Button variant="outline" size="sm" onClick={() => setRevision((n) => n + 1)}>Reload files</Button></div>}
    {!loading && !listError && files.length === 0 && <p className="text-sm text-muted-foreground">No quotation files uploaded yet.</p>}
    <ul className="space-y-3">
      {files.filter((f) => !queued.some((q) => q.id === f.id)).map((file) => <li key={file.id} className="min-w-0 rounded-md border p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0"><p className="break-all text-sm font-medium">{file.file_name}</p>
            <p className="text-xs text-muted-foreground">{Math.ceil(file.file_size / 1024)} KB · {file.uploaded_at ? "Uploaded" : "Incomplete upload"}</p></div>
          {file.uploaded_at && <Button size="sm" variant="outline" onClick={() => void download(file.id)} aria-label={"Download " + file.file_name}>Download</Button>}
        </div>
        {!file.uploaded_at && canWrite && <div className="mt-2 space-y-2">
          <p className="text-xs text-muted-foreground">Check whether the upload finished, or select the original file to retry.</p>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void recover(file.id)}>Check upload</Button>
          <Input type="file" accept={QUOTATION_ACCEPT} aria-label={"Retry " + file.file_name} disabled={busy} className="h-auto py-2"
            onChange={(e) => {
              const selected = e.target.files?.[0]; e.target.value = "";
              if (!selected) return;
              const error = quotationFileError(selected);
              if (error) { toast.error(error); return; }
              if (selected.name !== file.file_name || selected.size !== file.file_size) { toast.error("Select the same original file, with the same name and size."); return; }
              const item = { id: file.id, file: selected };
              setQueued((q) => [...q, item]); void upload([item]);
            }} />
        </div>}
      </li>)}
    </ul>
    {!canWrite && <DisabledHint reason={gateReason("sales.write")}><Button disabled variant="outline" size="sm">Upload file</Button></DisabledHint>}
    {canWrite && <div className="space-y-2 rounded-md border p-3">
      <QuotationFilePicker saved files={queued} onChange={setQueued} disabled={busy} />
      {queued.some((q) => errors[q.id]) && <div role="alert" className="space-y-1 text-sm">
        <p>The visit is saved. Retry the files below before leaving this page.</p>
        {queued.filter((q) => errors[q.id]).map((q) => <p key={q.id} className="break-all">{q.file.name}: {errors[q.id]}</p>)}
      </div>}
      {queued.length > 0 && <Button disabled={busy} onClick={() => void upload(queued)}>{busy ? "Uploading…" : "Upload / retry files"}</Button>}
      {busy && <p role="status" className="text-xs text-muted-foreground">Uploading quotation files. Keep this page open until complete.</p>}
    </div>}
  </div>;
}
