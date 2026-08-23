import { describe, expect, it } from "vitest";
import {
  TASK_TYPE_FIELDS,
  correctableFor,
  isRequiredFor,
  unresolvedRequired,
} from "@/features/sources/schema";

describe("review field dispatch", () => {
  it("still asks the upload flow for product fields", () => {
    const keys = correctableFor("product").map((f) => f.key);
    expect(keys).toContain("category_id");
    expect(keys).toContain("brand_id");
    // Price-only fields must not leak into a product review.
    expect(keys).not.toContain("price_list_id");
  });

  it("still asks the upload flow for price fields", () => {
    const keys = correctableFor("price").map((f) => f.key);
    expect(keys).toContain("price_list_id");
    expect(keys).toContain("tax_basis");
    expect(keys).not.toContain("category_id");
  });

  // The bug this registry exists to fix: a corpus task rendered the product form
  // because its item_type matched none of the appliesTo lists, leaving only the
  // fields that apply to everything.
  it("does not ask a certificate task for a product code and price basis", () => {
    const keys = correctableFor("certificate_scope_review", "certificate_scope_review").map((f) => f.key);
    expect(keys).toContain("scope_type");
    expect(keys).not.toContain("code");
    expect(keys).not.toContain("unit_id");
  });

  it("asks a size task about the unit, and nothing commercial", () => {
    const keys = correctableFor("dimension_unit_unstated", "dimension_unit_unstated").map((f) => f.key);
    expect(keys).toEqual(["dimension_unit", "chosen_size", "source_ref"]);
    expect(keys).not.toContain("currency");
  });

  it("prefers the task type over the item type when both are present", () => {
    // An item_type of 'price' would otherwise pull in the whole pricing form.
    const keys = correctableFor("price", "duplicate_code_resolution").map((f) => f.key);
    expect(keys).toContain("resolution");
    expect(keys).not.toContain("price_list_id");
  });

  it("falls back to the item type for an unknown task type", () => {
    const keys = correctableFor("price", "some_future_task_nobody_has_written_yet").map((f) => f.key);
    expect(keys).toContain("price_list_id");
  });

  it("blocks approval until the task's own question is answered", () => {
    const blockers = unresolvedRequired("dimension_unit_unstated", {}, "dimension_unit_unstated");
    expect(blockers.map((f) => f.key)).toEqual(["dimension_unit"]);

    const answered = unresolvedRequired("dimension_unit_unstated", { dimension_unit: "mm" }, "dimension_unit_unstated");
    expect(answered).toHaveLength(0);
  });

  it("treats whitespace as unanswered", () => {
    const blockers = unresolvedRequired("dimension_unit_unstated", { dimension_unit: "   " }, "dimension_unit_unstated");
    expect(blockers.map((f) => f.key)).toEqual(["dimension_unit"]);
  });

  it("marks the task's own required fields as required", () => {
    const [scope] = correctableFor("certificate_scope_review", "certificate_scope_review");
    expect(isRequiredFor(scope, "certificate_scope_review", "certificate_scope_review")).toBe(true);
  });

  it("every registered task asks at least one required question", () => {
    for (const [taskType, fields] of Object.entries(TASK_TYPE_FIELDS)) {
      const required = fields.filter((f) => f.required?.includes(taskType));
      expect(required.length, `${taskType} has no required field`).toBeGreaterThan(0);
    }
  });

  it("every task's required list names its own task type", () => {
    // A copy-paste that left another task's key behind would silently make the
    // field optional, which is how a review queue starts approving blanks.
    for (const [taskType, fields] of Object.entries(TASK_TYPE_FIELDS)) {
      for (const f of fields) {
        if (!f.required) continue;
        expect(f.required, `${taskType}.${f.key}`).toContain(taskType);
      }
    }
  });
});
