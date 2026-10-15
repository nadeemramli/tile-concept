import { z } from "zod";
import { uuid } from "@/lib/zod";

export const routingConfigSchema = z.object({
  enabled: z.boolean(),
  pools: z.array(z.object({
    key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/), name: z.string().trim().min(1).max(100),
    mode: z.enum(["fixed", "round_robin"]), active: z.boolean(),
    members: z.array(z.object({ name: z.string().trim().min(1).max(100), user_id: uuid().nullable(), active: z.boolean() })).min(1).max(30),
  })).min(1).max(20),
  rules: z.array(z.object({
    customer_type: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/), pool_key: z.string().nullable(),
    aliases: z.array(z.string().trim().toLowerCase().min(1).max(100)).min(1).max(30),
  })).min(1).max(30),
}).superRefine((config, ctx) => {
  const keys = new Set<string>(), aliases = new Set<string>();
  for (const pool of config.pools) {
    if (keys.has(pool.key)) ctx.addIssue({code: "custom", message: "Pool keys must be unique."});
    keys.add(pool.key);
    if (pool.mode === "fixed" && pool.members.length !== 1) ctx.addIssue({code: "custom", message: "A fixed pool needs exactly one member slot."});
    const users = pool.members.flatMap(m => m.user_id ? [m.user_id] : []);
    if (new Set(users).size !== users.length) ctx.addIssue({code: "custom", message: "A salesperson can appear only once in each pool."});
  }
  for (const rule of config.rules) {
    if (rule.pool_key && !keys.has(rule.pool_key)) ctx.addIssue({code: "custom", message: "Choose an existing pool for each rule."});
    for (const alias of rule.aliases) {
      if (aliases.has(alias)) ctx.addIssue({code: "custom", message: `Customer type alias appears twice: ${alias}`});
      aliases.add(alias);
    }
  }
});
export type RoutingConfig = z.infer<typeof routingConfigSchema>;
export const routingStateSchema = z.object({config: routingConfigSchema, version: z.number().int().nonnegative()});
export type RoutingState = z.infer<typeof routingStateSchema>;

export const saveRoutingSchema = z.object({config: routingConfigSchema, version: z.number().int().nonnegative()});
