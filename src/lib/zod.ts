import { z } from "zod";

/**
 * PostgreSQL `uuid` accepts any 8-4-4-4-12 hex string, including values that
 * are not RFC 4122 (no version/variant bits) — e.g. fixture ids and ids
 * imported from external systems. Zod 4's `.uuid()` enforces those bits and
 * would reject them, so all id fields use this lenient validator instead.
 */
export const uuid = () => z.string().regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/, "Invalid id");

/** Optional id: accepts an id, undefined, or "" (unset select). */
export const optionalUuid = () => uuid().optional().or(z.literal(""));
