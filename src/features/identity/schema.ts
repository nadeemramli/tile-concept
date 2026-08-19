import { z } from "zod";
import { uuid } from "@/lib/zod";

export const mergeSchema = z.object({
  candidate_id: uuid().optional(),
  survivor_id: uuid(),
  merged_id: uuid(),
  reason: z.string().trim().min(5, "Explain why these are the same person (min 5 characters)"),
});

export const rejectSchema = z.object({ candidate_id: uuid(), note: z.string().trim().optional() });
export const unmergeSchema = z.object({ merge_event_id: uuid(), reason: z.string().trim().min(5, "Reason is required") });
