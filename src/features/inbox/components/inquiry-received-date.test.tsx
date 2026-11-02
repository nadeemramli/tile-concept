import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InquiryReceivedDate } from "./inquiry-received-date";
import type { LeadRow } from "@/features/inbox/types";
const mock = vi.hoisted(() => ({ save: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mock.refresh }) }));
vi.mock("@/server/commands/inquiry", () => ({ correctInquiryReceivedDateAction: mock.save }));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
const lead = { id: "eeeeeeee-2109-0015-0100-000000000001", received_at: "2026-11-02T01:00:37.123Z", created_at: "2026-11-02T01:00:37.123Z" } as LeadRow;
afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe("enquiry date correction", () => {
  it("preserves entry time and safely retries an uncertain correction", async () => {
    const user = userEvent.setup();
    mock.save.mockRejectedValueOnce(new Error("Network unavailable")).mockResolvedValueOnce({ ok: true, message: "Date corrected" });
    render(<InquiryReceivedDate lead={lead} canWrite />);
    expect(screen.getByText("Entered into system at")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Edit enquiry received date" }));
    expect(screen.getByLabelText("Enquiry received at")).toHaveValue("2026-11-02T09:00:37.123");
    fireEvent.change(screen.getByLabelText("Enquiry received at"), { target: { value: "2026-10-24T13:00" } });
    await user.type(screen.getByLabelText("Correction reason"), "Historical enquiry from WhatsApp history");
    await user.click(screen.getByRole("button", { name: "Save date" }));
    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: "Save date" }));
    await waitFor(() => expect(mock.refresh).toHaveBeenCalledOnce());
    expect(mock.save).toHaveBeenCalledTimes(2);
    expect(mock.save.mock.calls[0][0]).toEqual(mock.save.mock.calls[1][0]);
    expect(mock.save.mock.calls[0][0]).toMatchObject({ received_at: "2026-10-24T05:00:00.000Z", expected_received_at: lead.received_at });
    expect(mock.save.mock.calls[0][0]).not.toHaveProperty("created_at");
  });
  it("does not offer editing to staff without write access", () => {
    render(<InquiryReceivedDate lead={lead} canWrite={false} />);
    expect(screen.queryByRole("button", { name: "Edit enquiry received date" })).not.toBeInTheDocument();
  });
  it("shows server conflicts without hiding the correction form", async () => {
    const user=userEvent.setup();
    mock.save.mockResolvedValue({ ok:false,error:"The enquiry date changed. Refresh and review." });
    render(<InquiryReceivedDate lead={lead} canWrite />);
    await user.click(screen.getByRole("button",{name:"Edit enquiry received date"}));
    await user.type(screen.getByLabelText("Correction reason"),"Correct historical entry");
    await user.click(screen.getByRole("button",{name:"Save date"}));
    expect(await screen.findByRole("alert")).toHaveTextContent("Refresh and review");
    expect(mock.refresh).not.toHaveBeenCalled();
  });
});
