"use client";

import { useId } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { QUOTATION_ACCEPT, quotationFileError, type QueuedQuotation } from "../quotation-files";

export function QuotationFilePicker({ files, onChange, disabled = false, saved = false }: {
  files: QueuedQuotation[]; onChange: (files: QueuedQuotation[]) => void; disabled?: boolean; saved?: boolean;
}) {
  const id = useId();
  return <div className="space-y-2">
    <label htmlFor={id} className="text-xs font-medium">Choose quotation files</label>
    <Input id={id} type="file" multiple accept={QUOTATION_ACCEPT} disabled={disabled}
      aria-describedby={id + "-hint"} className="h-auto min-w-0 py-2"
      onChange={(event) => {
        const next = [...files];
        for (const file of Array.from(event.target.files ?? [])) {
          const error = quotationFileError(file);
          if (error) { toast.error(file.name + ": " + error); continue; }
          if (next.length >= 10) { toast.error("Choose up to 10 files at a time."); break; }
          if (next.some((q) => q.file.name === file.name && q.file.size === file.size && q.file.lastModified === file.lastModified)) continue;
          next.push({ id: crypto.randomUUID(), file });
        }
        onChange(next);
        event.target.value = "";
      }} />
    <p id={id + "-hint"} className="text-xs text-muted-foreground">Excel (.xlsx, .xls) or PDF · up to 10 MB each. {saved ? "Keep the original files here for later download." : "Files are uploaded after the visit is saved."}</p>
    {files.length > 0 && <ul className="space-y-1">
      {files.map((q) => <li key={q.id} className="flex min-w-0 items-center justify-between gap-2 text-sm">
        <span className="min-w-0 break-all">{q.file.name} <span className="text-xs text-muted-foreground">({Math.ceil(q.file.size / 1024)} KB)</span></span>
        <Button type="button" size="sm" variant="ghost" disabled={disabled} aria-label={"Remove " + q.file.name}
          onClick={() => onChange(files.filter((f) => f.id !== q.id))}>Remove</Button>
      </li>)}
    </ul>}
  </div>;
}
