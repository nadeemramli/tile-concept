import { z } from "zod";
import { uuid } from "@/lib/zod";

export const TASK_VIEWS = ["mine", "overdue", "all", "done"] as const;
export type TaskView = (typeof TASK_VIEWS)[number];

const optionalUuid = uuid().optional().or(z.literal(""));

export const newTaskSchema = z.object({
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().max(4000).optional().or(z.literal("")),
  priority: z.enum(["low", "normal", "high", "urgent"]),
  due_at: z.string().optional().or(z.literal("")),
  assignee_id: optionalUuid,
  contact_id: optionalUuid,
  account_id: optionalUuid,
  opportunity_id: optionalUuid,
  lead_id: optionalUuid,
  project_id: optionalUuid,
});
export type NewTaskInput = z.infer<typeof newTaskSchema>;

export const updateTaskSchema = z.object({
  task_id: uuid(),
  due_at: z.string().optional().or(z.literal("")),
  assignee_id: optionalUuid,
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  title: z.string().trim().min(2).max(200).optional(),
});
