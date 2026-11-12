import { z } from "zod";

const stop = z.object({
  id: z.uuid(), document: z.string(), line: z.string(), item: z.string(),
  quantity: z.number(), unit: z.string(), ready: z.boolean(),
});

export const coordinatorSchedules = z.array(z.object({
  tripId: z.uuid(), driver: z.string().nullable(), stops: z.array(stop), token: z.string(),
  revision: z.int().nullable(), acknowledgedAt: z.string().nullable(), changed: z.boolean(),
}));

export const driverSchedules = z.array(z.object({
  id: z.uuid(), label: z.string(), date: z.iso.date(), revision: z.int(), stops: z.array(stop),
  previousStops: z.array(stop).nullable(), acknowledgedAt: z.string().nullable(),
}));
