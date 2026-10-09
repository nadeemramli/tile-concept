import { describe, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ProductStock } from "./product-stock";
import type { AvailabilityRow, ProductStockResult } from "@/server/queries/stock";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/components/shell/session-context", () => ({ useSession: () => ({ session: { roleLabel: "Marketing coordinator" } }) }));

const A = "aaaaaaaa-0000-0000-0000-00000000000a";
const B = "bbbbbbbb-0000-0000-0000-00000000000b";
const variants = [{ id: A, sku: "SKU-A", name: null }, { id: B, sku: "SKU-B", name: null }];
const line = (patch: Partial<AvailabilityRow>): AvailabilityRow => ({
  key: Math.random().toString(), source_kind: "in_house", variant_id: A, product_id: "p", product_code: "P1", product_name: "Tile", source_name: "SQL Account",
  location_name: "WH-A", supplier_id: null, supplier_name: null, availability: "available", quantity: 35, on_hand: 40, allocated: 5, unit_code: "box",
  as_of: new Date().toISOString(), expected_replenishment: null, source_channel: null, sla_minutes: 240, is_authoritative: true, evidence_storage_path: null,
  notes: null, brand_id: null, category_id: null, ...patch,
});

async function show(stock: Promise<ProductStockResult> | null) {
  await act(async () => { render(<TooltipProvider><ProductStock stock={stock} variants={variants} productCode="P1" /></TooltipProvider>); });
}

describe("product stock tab", () => {
  it("shows a loading state until the stock read resolves", async () => {
    let resolve!: (r: ProductStockResult) => void;
    await show(new Promise((r) => { resolve = r; }));
    expect(screen.getByText("Loading stock…")).toBeInTheDocument();
    await act(async () => resolve({ ok: true, rows: [line({})] }));
    expect(screen.queryByText("Loading stock…")).not.toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Stock by variant and warehouse" })).toBeInTheDocument();
  });

  it("shows balances per warehouse, an in-house total, and an explicit no-record line", async () => {
    await show(Promise.resolve({ ok: true, rows: [line({}), line({ location_name: "WH-B", quantity: 12, on_hand: 12, allocated: 0, availability: "available" })] }));
    const table = screen.getByRole("table");
    expect(within(table).getByText("WH-A")).toBeInTheDocument();
    expect(within(table).getByText("WH-B")).toBeInTheDocument();
    expect(within(table).getByText("In-house total across warehouses").closest("tr")).toHaveTextContent(/47\s*box/);
    expect(within(table).getByText("No stock record for this variant").closest("tr")).toHaveTextContent("SKU-B");
  });

  it("never renders a non-numeric state as zero and never totals it", async () => {
    await show(Promise.resolve({ ok: true, rows: [line({}), line({ location_name: "WH-B", availability: "unknown", quantity: null, on_hand: null, allocated: null })] }));
    expect(screen.queryByText("In-house total across warehouses")).not.toBeInTheDocument();
    const cells = within(screen.getByText("WH-B").closest("tr")!).getAllByRole("cell");
    for (const index of [4, 5, 6]) expect(cells[index]).toHaveTextContent(/^—$/);
  });

  it("shows a failure instead of an empty table and retries", async () => {
    await show(Promise.resolve({ ok: false, error: "Network unreachable." }));
    expect(screen.getByText("Stock could not be loaded")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Retry/ }));
    expect(refresh).toHaveBeenCalled();
  });

  it("shows an empty state for a product with no variants and no lines", async () => {
    await act(async () => { render(<TooltipProvider><ProductStock stock={Promise.resolve({ ok: true, rows: [] })} variants={[]} productCode="P1" /></TooltipProvider>); });
    expect(screen.getByText("No stock recorded")).toBeInTheDocument();
  });

  it("explains the missing role instead of showing stock", async () => {
    await show(null);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByText(/stock/i)).toBeInTheDocument();
  });
});
