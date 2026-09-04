import Link from "next/link";
import { Camera, CheckCircle2, ExternalLink, MessageCircle } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TonePill } from "@/components/patterns/status-pill";
import { formatDateTime, formatMoney } from "@/lib/format";
import type { FeedbackRequestRow } from "@/features/feedback/types";

const toneFor = (status: string): "success" | "warning" | "neutral" | "destructive" => status === "confirmed" ? "success" : status === "awaiting_customer" ? "warning" : status === "declined" ? "neutral" : "destructive";

export function FeedbackTrackingTable({ requests }: { requests: FeedbackRequestRow[] }) {
  if (requests.length === 0) return <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">No feedback requests yet. Start from a completed purchase.</div>;
  return (
    <div className="overflow-hidden rounded-lg border">
      <Table>
        <TableHeader><TableRow><TableHead>Customer</TableHead><TableHead>Purchase</TableHead><TableHead>Status</TableHead><TableHead>Evidence</TableHead><TableHead>Prepared</TableHead></TableRow></TableHeader>
        <TableBody>
          {requests.map((request) => (
            <TableRow key={request.id}>
              <TableCell><Link href={`/sales/contacts/${request.contact_id}`} className="font-medium hover:underline">{request.customer_name}</Link><div className="text-xs text-muted-foreground">{request.location_name ?? "No location"}</div></TableCell>
              <TableCell><Link href={`/sales/walk-ins?tab=purchases&purchase=${request.purchase_id}`} className="font-mono text-xs hover:underline">{request.purchase_ref ?? "Purchase"}</Link><div className="tnum text-xs text-muted-foreground">{formatMoney(request.purchase_amount, request.purchase_currency)}</div></TableCell>
              <TableCell><TonePill tone={toneFor(request.status)} label={request.status.replaceAll("_", " ")} size="md" /></TableCell>
              <TableCell><div className="flex flex-wrap gap-1.5">{request.customer_confirmed_at ? <CheckCircle2 className="size-4 text-success" aria-label="Private feedback confirmed" /> : <MessageCircle className="size-4 text-muted-foreground" aria-label="Awaiting customer" />}{request.has_photo ? <Camera className="size-4 text-info" aria-label="Photo attached" /> : null}{request.google_handoff_opened_at ? <ExternalLink className="size-4 text-ai" aria-label="Google handoff opened" /> : null}</div><div className="mt-1 text-[11px] text-muted-foreground">{request.benefit_status === "granted_for_private_feedback" ? "Private-feedback benefit recorded" : "No benefit recorded"}</div></TableCell>
              <TableCell className="text-xs"><span title={formatDateTime(request.created_at)}>{formatDateTime(request.created_at)}</span><div className="text-muted-foreground">{request.salesperson_name ?? "—"}</div></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
