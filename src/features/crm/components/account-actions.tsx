"use client";

import { useState } from "react";
import { FolderPlus, ListTodo, MessageSquarePlus, Pencil, Tag, UserCog, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Gated } from "@/components/patterns/explain";
import { useSession } from "@/components/shell/session-context";
import { PicOnly, usePicLock } from "@/features/crm/components/pic-only";
import type { AccountDetail } from "@/server/queries/accounts";
import type { MemberOption } from "@/features/crm/components/selects";
import { CreateOpportunityDialog } from "@/features/pipeline/components/create-opportunity-dialog";
import { ActivityDialog, AddAliasDialog, AddContactToAccountDialog, EditAccountDialog, NewContactDialog, ProjectOpportunityDialog, TaskDialog, TransferPicDialog } from "@/features/crm/components/dialogs";

type Which = "edit" | "activity" | "task" | "project" | "contact" | "alias" | "newcontact" | "registration" | "transfer" | null;

export function AccountActions({ account, members }: { account: AccountDetail; members: MemberOption[] }) {
  const { can, session } = useSession();
  const [open, setOpen] = useState<Which>(null);
  const lock = usePicLock(account.owner_id, members);
  if (!can("sales.write")) return null;
  const primary = account.contacts.find((c) => c.is_primary) ?? account.contacts[0];
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" size="sm" onClick={() => setOpen("activity")}>
        <MessageSquarePlus className="size-3.5" aria-hidden /> Log activity
      </Button>
      <Button variant="outline" size="sm" onClick={() => setOpen("task")}>
        <ListTodo className="size-3.5" aria-hidden /> Task
      </Button>
      <Button variant="outline" size="sm" onClick={() => setOpen("project")}>
        <FolderPlus className="size-3.5" aria-hidden /> New opportunity
      </Button>
      <Button variant="outline" size="sm" onClick={() => setOpen("registration")}><FolderPlus className="size-3.5" aria-hidden /> Register project</Button>
      <Button variant="outline" size="sm" onClick={() => setOpen("newcontact")}><UserPlus className="size-3.5" aria-hidden /> New contact</Button>
      <Button variant="outline" size="sm" onClick={() => setOpen("contact")}>
        <UserPlus className="size-3.5" aria-hidden /> Link existing contact
      </Button>
      <PicOnly lock={lock}>
        <Button variant="outline" size="sm" onClick={() => setOpen("alias")}>
          <Tag className="size-3.5" aria-hidden /> Alias
        </Button>
      </PicOnly>
      <PicOnly lock={lock}>
        <Button variant="outline" size="sm" onClick={() => setOpen("edit")}>
          <Pencil className="size-3.5" aria-hidden /> Edit
        </Button>
      </PicOnly>
      <Gated permission="sales.assign">
        <Button variant="outline" size="sm" onClick={() => setOpen("transfer")}>
          <UserCog className="size-3.5" aria-hidden /> Transfer PIC
        </Button>
      </Gated>
      <EditAccountDialog open={open === "edit"} onOpenChange={() => setOpen(null)} account={account} members={members} />
      <ActivityDialog open={open === "activity"} onOpenChange={() => setOpen(null)} links={{ account_id: account.id }} />
      <TaskDialog open={open === "task"} onOpenChange={() => setOpen(null)} members={members} links={{ account_id: account.id }} defaultAssignee={session.userId} />
      <CreateOpportunityDialog open={open === "project"} onOpenChange={() => setOpen(null)} members={members} defaults={{ account_id: account.id, account_name: account.name, contact_id: primary?.contact_id, contact_name: primary?.display_name }} />
      {open === "registration" && <ProjectOpportunityDialog open onOpenChange={() => setOpen(null)} members={members} defaults={{ account_id: account.id, account_name: account.name }} />}
      <NewContactDialog open={open === "newcontact"} onOpenChange={() => setOpen(null)} members={members} defaultAccountId={account.id} defaultAccountName={account.name} />
      <AddContactToAccountDialog open={open === "contact"} onOpenChange={() => setOpen(null)} accountId={account.id} />
      <AddAliasDialog open={open === "alias"} onOpenChange={() => setOpen(null)} accountId={account.id} />
      {open === "transfer" && <TransferPicDialog open onOpenChange={() => setOpen(null)} card="account" id={account.id} currentOwnerId={account.owner_id} members={members} />}
    </div>
  );
}
