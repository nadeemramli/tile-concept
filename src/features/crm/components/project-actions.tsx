"use client";

import { useState } from "react";
import { ListTodo, MapPin, Megaphone, MessageSquarePlus, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSession } from "@/components/shell/session-context";
import type { ProjectDetail } from "@/server/queries/projects";
import type { MemberOption } from "@/features/crm/components/selects";
import { ActivityDialog, AddSiteDialog, EditProjectDialog, TaskDialog } from "@/features/crm/components/dialogs";

type Which = "edit" | "activity" | "task" | "site" | null;

export function ProjectActions({ project, members }: { project: ProjectDetail; members: MemberOption[] }) {
  const { can, session } = useSession();
  const [open, setOpen] = useState<Which>(null);
  const links = { project_id: project.id, contact_id: project.contact_id ?? undefined, account_id: project.account_id ?? undefined };
  return (
    <div className="flex flex-wrap gap-2">
      <Tooltip>
        <TooltipTrigger asChild>
          <span>
            <Button variant="outline" size="sm" disabled>
              <Megaphone className="size-3.5" aria-hidden /> Nominate for content
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>Phase 2 — Marketing Coordination</TooltipContent>
      </Tooltip>
      {can("sales.write") && (
        <>
          <Button variant="outline" size="sm" onClick={() => setOpen("activity")}>
            <MessageSquarePlus className="size-3.5" aria-hidden /> Log activity
          </Button>
          <Button variant="outline" size="sm" onClick={() => setOpen("task")}>
            <ListTodo className="size-3.5" aria-hidden /> Task
          </Button>
          <Button variant="outline" size="sm" onClick={() => setOpen("site")}>
            <MapPin className="size-3.5" aria-hidden /> Add site
          </Button>
          <Button variant="outline" size="sm" onClick={() => setOpen("edit")}>
            <Pencil className="size-3.5" aria-hidden /> Edit
          </Button>
          <EditProjectDialog open={open === "edit"} onOpenChange={() => setOpen(null)} project={project} members={members} />
          <ActivityDialog open={open === "activity"} onOpenChange={() => setOpen(null)} links={links} />
          <TaskDialog open={open === "task"} onOpenChange={() => setOpen(null)} members={members} links={links} defaultAssignee={session.userId} />
          <AddSiteDialog open={open === "site"} onOpenChange={() => setOpen(null)} projectId={project.id} />
        </>
      )}
    </div>
  );
}
