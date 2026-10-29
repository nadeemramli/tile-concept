import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProductMedia } from "./product-media";

const mocks = vi.hoisted(() => ({ prepare: vi.fn(), complete: vi.fn(), upload: vi.fn(), info: vi.fn(), refresh: vi.fn(), toast: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("sonner", () => ({ toast: { success: mocks.toast, error: mocks.toast } }));
vi.mock("@/lib/supabase/client", () => ({ getBrowserSupabase: () => ({ storage: { from: () => ({ uploadToSignedUrl: mocks.upload, info: mocks.info }) } }) }));
vi.mock("@/server/commands/catalog-media", () => ({ prepareCatalogMediaAction: mocks.prepare, completeCatalogMediaAction: mocks.complete, archiveCatalogMediaAction: vi.fn(), setPrimaryCatalogMediaAction: vi.fn(), updateCatalogMediaAction: vi.fn() }));

const existing = { id: "33333333-3333-3333-3333-333333333333", kind: "image", storage_path: "w/p/u/a.jpg", is_primary: true, url: null, variant_id: "44444444-4444-4444-4444-444444444444", caption: "Face", alt_text: null, source_ref: null, original_filename: "a.jpg", mime_type: "image/jpeg", review_state: "reviewed", usage_rights_state: "accepted" } as unknown as Parameters<typeof ProductMedia>[0]["media"][number];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prepare.mockResolvedValue({ ok: true, data: { path: "workspace/products/product/user/photo.jpg", token: "signed-token" } });
  mocks.upload.mockResolvedValue({ error: null });
  mocks.complete.mockResolvedValue({ ok: true, data: { id: "photo" } });
});

describe("product media upload", () => {
  it("requires explicit rights, then uploads and finalizes a product attachment", async () => {
    const user = userEvent.setup();
    render(<ProductMedia productId="11111111-1111-4111-8111-111111111111" variants={[]} media={[]} canWrite />);
    const file = new File([new Uint8Array([255,216,255])], "tile.jpg", { type: "image/jpeg" });
    await user.upload(screen.getByLabelText("Upload media"), file);
    expect(screen.getByRole("button", { name: "Upload media" })).toBeDisabled();
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Upload media" }));
    await waitFor(() => expect(mocks.complete).toHaveBeenCalledOnce());
    expect(mocks.prepare.mock.calls[0][0]).toMatchObject({ product_id: "11111111-1111-4111-8111-111111111111", variant_id: null, filename: "tile.jpg", rights_confirmed: true });
    expect(mocks.upload).toHaveBeenCalledWith("workspace/products/product/user/photo.jpg", "signed-token", file, { contentType: "image/jpeg", upsert: false });
    await waitFor(() => expect(screen.getByText(/tile.jpg · Attached/)).toBeInTheDocument());
  });
  it("keeps media identity on retry and does not finalize failed uploads", async () => {
    mocks.upload.mockResolvedValueOnce({ error: { message: "Disconnected" } });
    mocks.info.mockResolvedValueOnce({ error: { message: "Missing" }, data: null });
    const user = userEvent.setup();
    render(<ProductMedia productId="11111111-1111-4111-8111-111111111111" variants={[]} media={[]} canWrite />);
    await user.upload(screen.getByLabelText("Upload media"), new File([new Uint8Array([255,216,255])], "tile.jpg", { type: "image/jpeg" }));
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Upload media" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Retry upload" })).toBeEnabled());
    expect(mocks.complete).not.toHaveBeenCalled();
    const originalId = mocks.prepare.mock.calls[0][0].media_id;
    await user.click(screen.getByRole("button", { name: "Retry upload" }));
    await waitFor(() => expect(mocks.complete).toHaveBeenCalledOnce());
    expect(mocks.prepare.mock.calls[1][0].media_id).toBe(originalId);
  });
  it("does not expose upload controls to read-only staff", () => {
    render(<ProductMedia productId="11111111-1111-4111-8111-111111111111" variants={[]} media={[existing]} canWrite={false} />);
    expect(screen.queryByRole("button", { name: "Upload media" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Replace" })).not.toBeInTheDocument();
    expect(screen.queryByText(/rights accepted/)).not.toBeInTheDocument();
  });
  it("replaces an attachment only after its own rights confirmation, keeping its variant", async () => {
    const user = userEvent.setup();
    render(<ProductMedia productId="11111111-1111-4111-8111-111111111111" variants={[{ id: existing.variant_id!, sku: "SKU-1", name: null }]} media={[existing]} canWrite />);
    await user.click(screen.getByRole("button", { name: "Replace" }));
    const file = new File([new Uint8Array([137,80,78,71,13,10,26,10])], "new.png", { type: "image/png" });
    await user.upload(screen.getByLabelText("Replacement file"), file);
    expect(screen.getByRole("button", { name: "Replace file" })).toBeDisabled();
    await user.click(screen.getAllByRole("checkbox").at(-1)!);
    await user.click(screen.getByRole("button", { name: "Replace file" }));
    await waitFor(() => expect(mocks.complete).toHaveBeenCalledOnce());
    expect(mocks.complete.mock.calls[0][0]).toMatchObject({ replaces_id: existing.id, variant_id: existing.variant_id, mime_type: "image/png", rights_confirmed: true });
  });
});
