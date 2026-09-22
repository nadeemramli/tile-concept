import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ prepare: vi.fn(), finish: vi.fn(), upload: vi.fn(), large: vi.fn() }));
vi.mock("./upload-large-quotation", () => ({ uploadLargeQuotation: mocks.large }));
vi.mock("@/server/commands/visit-quotations", () => ({ prepareVisitQuotationAction: mocks.prepare, finishVisitQuotationAction: mocks.finish }));
vi.mock("@/lib/supabase/client", () => ({ getBrowserSupabase: () => ({ storage: { from: () => ({ upload: mocks.upload }) } }) }));
import { uploadQuotation } from "./upload-quotation";
const queued = { id: "stable-file-id", file: new File(["synthetic"], "QT.xlsx") };
beforeEach(() => { vi.resetAllMocks(); mocks.prepare.mockResolvedValue({ ok: true, data: "private/path.xlsx" }); mocks.finish.mockResolvedValue({ ok: true }); });
describe("quotation upload retries", () => {
  it("uploads original bytes with canonical MIME without overwrite", async () => {
    mocks.upload.mockResolvedValue({ error: null });
    await uploadQuotation("saved-visit", queued);
    expect(mocks.upload).toHaveBeenCalledWith("private/path.xlsx", queued.file, { contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", upsert: false });
    expect(mocks.finish).toHaveBeenCalledWith("saved-visit", "stable-file-id");
  });
  it("recovers a lost storage response without another attachment or visit", async () => {
    mocks.upload.mockResolvedValue({ error: { message: "Already exists" } });
    await expect(uploadQuotation("saved-visit", queued)).resolves.toBeUndefined();
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
    expect(mocks.prepare.mock.calls[0][0].file_id).toBe("stable-file-id");
  });
  it("retains stable IDs across failed and successful retries", async () => {
    mocks.upload.mockResolvedValueOnce({ error: { message: "Network error" } }).mockResolvedValueOnce({ error: null });
    mocks.finish.mockResolvedValueOnce({ ok: false, error: "Missing" }).mockResolvedValueOnce({ ok: true });
    await expect(uploadQuotation("saved-visit", queued)).rejects.toThrow("Retry");
    await uploadQuotation("saved-visit", queued);
    expect(mocks.prepare.mock.calls.map(([arg]) => [arg.visit_id, arg.file_id])).toEqual([["saved-visit", "stable-file-id"], ["saved-visit", "stable-file-id"]]);
  });
  it("uses resumable upload above 6 MB", async () => {
    const file = new File([new Uint8Array(7 * 1024 * 1024)], "Large.xlsx");
    mocks.large.mockResolvedValue(undefined);
    await uploadQuotation("saved-visit", { id: "large-file-id", file });
    expect(mocks.large).toHaveBeenCalledWith("private/path.xlsx", file, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.finish).toHaveBeenCalledWith("saved-visit", "large-file-id");
  });
  it("never uploads when reservation is refused", async () => {
    mocks.prepare.mockResolvedValue({ ok: false, error: "Permission denied" });
    await expect(uploadQuotation("saved-visit", queued)).rejects.toThrow("Permission denied");
    expect(mocks.upload).not.toHaveBeenCalled();
  });
});
