"use client";

import { useState } from "react";
import { ListTodo, MapPin, Megaphone, MessageSquarePlus, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Gated, Hint } from "@/components/patterns/explain";
import { useSession } from "@/components/shell/session-context";
import type { ProjectDetail } from "@/server/queries/projects";
import type { MemberOption } from "@/features/crm/components/selects";
import { CreateOpportunityDialog } from "@/features/pipeline/components/create-opportunity-dialog";
import { ActivityDialog, AddSiteDialog, EditProjectDialog, TaskDialog } from "@/features/crm/components/dialogs";
import { NominateDialog } from "@/features/marketing/components/nominate-dialog";

type Which = "edit" | "activity" | "task" | "site" | "nominate" | "opportunity" | null;

export function ProjectActions({ project, members }: { project: ProjectDetail; members: MemberOption[] }) {
  const { session } = useSession();
  const [open, setOpen] = useState<Which>(null);
  const links = { project_id: project.id, contact_id: project.contact_id ?? undefined, account_id: project.account_id ?? undefined };
  return (
    <div className="flex flex-wrap gap-2">
      <Gated permission="sales.write"><Button variant="outline" size="sm" onClick={() => setOpen("opportunity")}>New opportunity</Button></Gated>
      {open === "opportunity" && <CreateOpportunityDialog open onOpenChange={() => setOpen(null)} members={members} defaults={{ project_id:project.id, contact_id:project.contact_id ?? undefined, contact_name:project.contact_name ?? undefined, account_id:project.account_id ?? undefined, account_name:project.account_name ?? undefined }} />}
      <Gated permission="marketing.write">
        <Hint content="Put this project forward for a testimonial, before/after or site shoot. Marketing reviews readiness and the customer's media permission before anything is booked.">
          <Button variant="outline" size="sm" onClick={() => setOpen("nominate")}>
            <Megaphone className="size-3.5" aria-hidden /> Nominate for content
          </Button>
        </Hint>
      </Gated>
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
        <Button variant="outline" size="sm" onClick={() => setOpen("site")}>
          <MapPin className="size-3.5" aria-hidden /> Add site
        </Button>
      </Gated>
      <Gated permission="sales.write">
        <Button variant="outline" size="sm" onClick={() => setOpen("edit")}>
          <Pencil className="size-3.5" aria-hidden /> Edit
        </Button>
      </Gated>
      <EditProjectDialog open={open === "edit"} onOpenChange={() => setOpen(null)} project={project} members={members} />
      <ActivityDialog open={open === "activity"} onOpenChange={() => setOpen(null)} links={links} />
      <TaskDialog open={open === "task"} onOpenChange={() => setOpen(null)} members={members} links={links} defaultAssignee={session.userId} />
      <AddSiteDialog open={open === "site"} onOpenChange={() => setOpen(null)} projectId={project.id} />
      {open === "nominate" && <NominateDialog open onOpenChange={(o) => !o && setOpen(null)} />}
    </div>
  );
}
