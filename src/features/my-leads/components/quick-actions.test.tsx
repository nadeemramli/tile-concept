import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/components/i18n/locale-context";
import type { MyLeadDetail } from "@/features/my-leads/types";
import { QuickActions } from "./quick-actions";

const mock = vi.hoisted(() => ({ work: vi.fn(), annotate: vi.fn(), success: vi.fn(), refresh: vi.fn(), can: vi.fn(() => true) }));
vi.mock("@/server/commands/inquiry", () => ({ workInquiryAction: mock.work, annotateInquiryAction: mock.annotate }));
vi.mock("@/components/shell/session-context", () => ({ useSession: () => ({ can: mock.can }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mock.refresh }) }));
vi.mock("sonner", () => ({ toast: { success: mock.success, error: vi.fn() } }));
afterEach(() => { cleanup(); vi.clearAllMocks(); mock.can.mockImplementation(() => true); });

const LEAD: MyLeadDetail = {
  id: "eeeeeeee-5600-0000-0000-000000000001", name: "Synthetic Buyer", company: null, status: "contacted", sourceChannel: "tiktok",
  interest: null, nextFollowUpAt: "2026-10-29T01:00:00.000Z", noNextActionReason: null, maskedPhone: "+60•••789",
  primary: "complete", ownerId: "u1", ownerName: "Rep", contact: null, firstWhatsappSentAt: "2026-10-28T01:00:00.000Z",
  firstCustomerReplyAt: null, contactAttempts: 1, nextFollowUpTaskId: "eeeeeeee-5600-0000-0000-0000000000aa", openFollowUps: 1,
  closed: false, secondary: ["customer_replied", "no_response", "reschedule", "remark"], canWrite: true, activity: [],
};

describe("my leads quick actions", () => {
  it("speaks Bahasa Melayu by default and completes the follow-up through the inbox command", async () => {
    const user = userEvent.setup();
    mock.work.mockResolvedValue({ ok: true, data: undefined });
    render(<LocaleProvider locale="ms"><QuickActions lead={LEAD} /></LocaleProvider>);
    await user.click(screen.getByRole("button", { name: "Susulan selesai" }));
    await user.click(screen.getByRole("button", { name: "Simpan" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("sekurang-kurangnya 3 aksara");
    expect(mock.work).not.toHaveBeenCalled();
    await user.type(screen.getByRole("textbox", { name: "Hasil / sebab (wajib)" }), "Called, will visit Saturday");
    await user.click(screen.getByRole("button", { name: "Simpan" }));
    await waitFor(() => expect(mock.work).toHaveBeenCalledOnce());
    expect(mock.work.mock.calls[0][0]).toMatchObject({ lead_id: LEAD.id, action: "complete", task_id: LEAD.nextFollowUpTaskId, body: "Called, will visit Saturday" });
    expect(mock.success).toHaveBeenCalledWith("Susulan selesai. Pilih tindakan seterusnya.");
    expect(mock.refresh).toHaveBeenCalledOnce();
  });

  it("retries an uncertain save with the same request ID so nothing is recorded twice", async () => {
    const user = userEvent.setup();
    mock.work.mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce({ ok: true, data: undefined });
    render(<LocaleProvider locale="en"><QuickActions lead={LEAD} /></LocaleProvider>);
    await user.click(screen.getByRole("button", { name: "Customer replied" }));
    await user.click(screen.getByRole("button", { name: "Phone" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("will not be recorded twice");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(mock.work).toHaveBeenCalledTimes(2));
    expect(mock.work.mock.calls[0][0].request_id).toBe(mock.work.mock.calls[1][0].request_id);
    expect(mock.work.mock.calls[1][0]).toMatchObject({ action: "customer_replied", channel: "phone" });
  });

  it("shows the database refusal and keeps the sheet open", async () => {
    const user = userEvent.setup();
    mock.annotate.mockResolvedValue({ ok: false, error: "Only the owner of this record, or a sales manager, can change it." });
    render(<LocaleProvider locale="en"><QuickActions lead={LEAD} /></LocaleProvider>);
    await user.click(screen.getByRole("button", { name: "Add remark" }));
    await user.type(screen.getByRole("textbox", { name: "Remark (required)" }), "Prefers grey tiles");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save. Only the owner");
    expect(mock.annotate.mock.calls[0][0]).toMatchObject({ action: "remark", body: "Prefers grey tiles" });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("renders every control disabled, with the reason, when the member cannot update the lead", () => {
    mock.can.mockImplementation(() => false);
    render(<LocaleProvider locale="en"><QuickActions lead={{ ...LEAD, canWrite: false }} /></LocaleProvider>);
    for (const button of screen.getAllByRole("button")) expect(button).toBeDisabled();
    expect(screen.getByText(/A sales representative, sales manager or showroom role can/)).toBeInTheDocument();
  });

  it("states a closed inquiry instead of offering a next action", () => {
    render(<LocaleProvider locale="ms"><QuickActions lead={{ ...LEAD, primary: null, closed: true, secondary: ["remark"] }} /></LocaleProvider>);
    expect(screen.getByText("Pertanyaan ini telah ditutup. Sejarahnya kekal tersedia.")).toBeInTheDocument();
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Tambah catatan"]);
  });
});
