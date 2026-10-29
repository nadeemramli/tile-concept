"use client";

import { useState } from "react";
import Link from "next/link";
import { Building2, Eye, ListTodo, MessageSquarePlus, Pencil, Phone, ShieldCheck, Store, FolderPlus, UserCog } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Gated } from "@/components/patterns/explain";
import { useSession } from "@/components/shell/session-context";
import { PicOnly, usePicLock } from "@/features/crm/components/pic-only";
import type { ContactDetail } from "@/server/queries/contacts";
import type { MemberOption } from "@/features/crm/components/selects";
import { CreateOpportunityDialog } from "@/features/pipeline/components/create-opportunity-dialog";
import { ActivityDialog, AddContactPointDialog, ConsentDialog, EditContactDialog, LinkAccountDialog, RevealButton, TaskDialog, TransferPicDialog } from "@/features/crm/components/dialogs";

type Which = "edit" | "activity" | "task" | "project" | "link" | "point" | "consent" | "transfer" | null;

/**
 * Every action is visible to every role. Those the role lacks render disabled
 * with the role that can, so nobody has to guess whether a button exists.
 */
export function ContactActions({ contact, members }: { contact: ContactDetail; members: MemberOption[] }) {
  const { can, session } = useSession();
  const [open, setOpen] = useState<Which>(null);
  const canWrite = can("sales.write");
  const canReveal = can("contact.reveal");
  // Card fields (name, phone/email, company links) belong to the PIC; logging
  // work against the customer stays open to the shared sales team.
  const lock = usePicLock(contact.owner_id, members);
  const primaryAccount = contact.relationships.find((r) => r.is_primary) ?? contact.relationships[0];
  return (
    <div className="flex flex-wrap gap-2">
      {canReveal ? (
        <RevealButton contactId={contact.id} canReveal />
      ) : (
        <Gated permission="contact.reveal">
          <Button variant="outline" size="sm">
            <Eye className="size-3.5" aria-hidden /> Reveal details
          </Button>
        </Gated>
      )}
      <Gated permission="sales.write">
        <Button variant="outline" size="sm" onClick={() => setOpen("activity")}>
          <MessageSquarePlus className="size-3.5" aria-hidden /> Log activity
        </Button>
      </Gated>
      <Gated permission="sales.write">
        <Button variant="outline" size="sm" onClick={() => setOpen("task")}>
          <ListTodo className="size-3.5" aria-hidden /> Task
        </Button>
      </Gated>
      <Gated permission="sales.write">
        <Button variant="outline" size="sm" onClick={() => setOpen("project")}>
          <FolderPlus className="size-3.5" aria-hidden /> New opportunity
        </Button>
      </Gated>
      {canWrite ? (
        <Button variant="outline" size="sm" asChild>
          <Link href={`/sales/walk-ins/new?contact=${contact.id}`}>
            <Store className="size-3.5" aria-hidden /> Walk-in
          </Link>
        </Button>
      ) : (
        <Gated permission="sales.write">
          <Button variant="outline" size="sm">
            <Store className="size-3.5" aria-hidden /> Walk-in
          </Button>
        </Gated>
      )}
      {canWrite ? (
        <PicOnly lock={lock}>
          <Button variant="outline" size="sm" onClick={() => setOpen("link")}>
            <Building2 className="size-3.5" aria-hidden /> Link account
          </Button>
        </PicOnly>
      ) : (
        <Gated permission="sales.write">
          <Button variant="outline" size="sm">
            <Building2 className="size-3.5" aria-hidden /> Link account
          </Button>
        </Gated>
      )}
      {canWrite ? (
        <PicOnly lock={lock}>
          <Button variant="outline" size="sm" onClick={() => setOpen("point")}>
            <Phone className="size-3.5" aria-hidden /> Add phone/email
          </Button>
        </PicOnly>
      ) : (
        <Gated permission="sales.write">
          <Button variant="outline" size="sm">
            <Phone className="size-3.5" aria-hidden /> Add phone/email
          </Button>
        </Gated>
      )}
      <Gated permission="sales.write">
        <Button variant="outline" size="sm" onClick={() => setOpen("consent")}>
          <ShieldCheck className="size-3.5" aria-hidden /> Consent
        </Button>
      </Gated>
      {canWrite ? (
        <PicOnly lock={lock}>
          <Button variant="outline" size="sm" onClick={() => setOpen("edit")}>
            <Pencil className="size-3.5" aria-hidden /> Edit
          </Button>
        </PicOnly>
      ) : (
        <Gated permission="sales.write">
          <Button variant="outline" size="sm">
            <Pencil className="size-3.5" aria-hidden /> Edit
          </Button>
        </Gated>
      )}
      <Gated permission="sales.assign">
        <Button variant="outline" size="sm" onClick={() => setOpen("transfer")}>
          <UserCog className="size-3.5" aria-hidden /> Transfer PIC
        </Button>
      </Gated>
      {open === "transfer" && <TransferPicDialog open onOpenChange={() => setOpen(null)} card="contact" id={contact.id} currentOwnerId={contact.owner_id} members={members} />}
      {canWrite && (
        <>
          <EditContactDialog open={open === "edit"} onOpenChange={() => setOpen(null)} contact={contact} />
          <ActivityDialog open={open === "activity"} onOpenChange={() => setOpen(null)} links={{ contact_id: contact.id, account_id: primaryAccount?.account_id }} />
          <TaskDialog open={open === "task"} onOpenChange={() => setOpen(null)} members={members} links={{ contact_id: contact.id, account_id: primaryAccount?.account_id }} defaultAssignee={session.userId} />
          <CreateOpportunityDialog open={open === "project"} onOpenChange={() => setOpen(null)} members={members} defaults={{ contact_id: contact.id, contact_name: contact.display_name, account_id: primaryAccount?.account_id, account_name: primaryAccount?.account_name }} />
          <LinkAccountDialog open={open === "link"} onOpenChange={() => setOpen(null)} contactId={contact.id} />
          <AddContactPointDialog open={open === "point"} onOpenChange={() => setOpen(null)} contactId={contact.id} />
          <ConsentDialog open={open === "consent"} onOpenChange={() => setOpen(null)} contactId={contact.id} />
        </>
      )}
    </div>
  );
}
