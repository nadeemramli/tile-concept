import { describe, expect, it } from "vitest";
import { createContactSchema, transferCustomerCardSchema, updateAccountSchema, updateContactSchema } from "@/features/crm/schema";

const id = "aaaaaaaa-0000-0000-0000-000000000004";

describe("customer card PIC payloads", () => {
  // A PIC named in a payload must reach the database, which refuses anyone but
  // the caller. Stripping it here would turn a forged request into a silent success.
  it("keeps a submitted PIC on create and edit so the database can refuse it", () => {
    expect(createContactSchema.parse({ display_name: "Synthetic", owner_id: id }).owner_id).toBe(id);
    expect(updateContactSchema.parse({ id, display_name: "Synthetic", owner_id: id }).owner_id).toBe(id);
    expect(updateAccountSchema.parse({ id, name: "Synthetic Co", owner_id: id }).owner_id).toBe(id);
  });

  it("leaves the PIC out when the form does not send one", () => {
    expect(updateAccountSchema.parse({ id, name: "Synthetic Co", owner_id: "" }).owner_id).toBeUndefined();
    expect(updateContactSchema.parse({ id, display_name: "Synthetic" }).owner_id).toBeUndefined();
  });

  it("requires a card, a new PIC and a reason to transfer", () => {
    expect(transferCustomerCardSchema.safeParse({ card: "contact", id, owner_id: id, reason: "Territory handover" }).success).toBe(true);
    expect(transferCustomerCardSchema.safeParse({ card: "contact", id, owner_id: id, reason: "  " }).success).toBe(false);
    expect(transferCustomerCardSchema.safeParse({ card: "project", id, owner_id: id, reason: "Territory handover" }).success).toBe(false);
    expect(transferCustomerCardSchema.safeParse({ card: "account", id, reason: "Territory handover" }).success).toBe(false);
  });
});
