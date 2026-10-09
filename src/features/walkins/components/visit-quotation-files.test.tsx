import { TooltipProvider } from "@/components/ui/tooltip";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
const mocks = vi.hoisted(() => ({ upload: vi.fn(), list: vi.fn(), finish: vi.fn(), download: vi.fn() }));
vi.mock("../upload-quotation", () => ({ uploadQuotation: mocks.upload }));
vi.mock("@/server/commands/visit-quotations", () => ({
  listVisitQuotationsAction: mocks.list, finishVisitQuotationAction: mocks.finish, downloadVisitQuotationAction: mocks.download,
}));
import { VisitQuotationFiles } from "./visit-quotation-files";
const attachment = { id: "file-id", visit_id: "visit-id", file_name: "Quotation.xlsx", file_size: 123, created_at: "2026-09-23", uploaded_at: "2026-09-23" };
beforeEach(() => { vi.resetAllMocks(); mocks.list.mockResolvedValue({ ok: true, data: [] }); });
describe("saved visit quotation files", () => {
  it("automatically uploads once and retries a failed file against the saved visit", async () => {
    const user = userEvent.setup();
    const file = { id: "stable-file-id", file: new File(["synthetic"], "Quotation.xlsx") };
    mocks.upload.mockRejectedValueOnce(new Error("Temporary network failure")).mockResolvedValueOnce(undefined);
    render(<StrictMode><VisitQuotationFiles visitId="saved-visit-id" canWrite initialFiles={[file]} /></StrictMode>);
    await screen.findByText("The visit is saved. Retry the files below before leaving this page.");
    expect(mocks.upload).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Upload / retry files" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Upload / retry files" })).not.toBeInTheDocument());
    expect(mocks.upload.mock.calls).toEqual([["saved-visit-id", file], ["saved-visit-id", file]]);
  });
  it("shows download access and an explained disabled upload button for readers", async () => {
    mocks.list.mockResolvedValue({ ok: true, data: [attachment] });
    render(<TooltipProvider><VisitQuotationFiles visitId="visit-id" canWrite={false} /></TooltipProvider>);
    expect(await screen.findByRole("button", { name: "Download Quotation.xlsx" })).toBeVisible();
    expect(screen.queryByLabelText("Choose quotation files")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload file" })).toBeDisabled();
  });
  it("recovers a pending upload after reopening the visit", async () => {
    const user = userEvent.setup();
    mocks.list.mockResolvedValueOnce({ ok: true, data: [{ ...attachment, uploaded_at: null }] })
      .mockResolvedValue({ ok: true, data: [attachment] });
    mocks.finish.mockResolvedValue({ ok: true });
    render(<VisitQuotationFiles visitId="visit-id" canWrite />);
    await user.click(await screen.findByRole("button", { name: "Check upload" }));
    expect(mocks.finish).toHaveBeenCalledWith("visit-id", "file-id");
    expect(await screen.findByRole("button", { name: "Download Quotation.xlsx" })).toBeVisible();
  });
});
