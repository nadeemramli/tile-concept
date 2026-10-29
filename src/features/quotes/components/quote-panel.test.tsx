import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SessionProvider } from "@/components/shell/session-context";
import type { AppSession } from "@/server/session";
import type { QuoteContext } from "../types";

const mocks = vi.hoisted(() => ({ load: vi.fn(), command: vi.fn(), refresh: vi.fn() }));
vi.mock("@/server/commands/quotes", () => ({ loadQuoteContextAction: mocks.load, quoteCommandAction: mocks.command }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
import { QuotePanel } from "./quote-panel";

const session = (permissions: string[]) => ({ userId: "u1", roleLabel: "Sales representative", permissions }) as unknown as AppSession;
const wrap = (perms = ["sales.read", "sales.write"]) => render(
  <SessionProvider session={session(perms)}><TooltipProvider delayDuration={0}><QuotePanel anchor={{ lead_id: "lead-1" }} /></TooltipProvider></SessionProvider>,
);

const ctx: QuoteContext = {
  quotes: [{
    id: "q1", quote_number: "QT-SYN-1", status: "revised", lifecycle: "sent", origin: "inbox", opportunity_id: null, lead_id: "lead-1", visit_id: "visit-1",
    current_version_no: 2, first_sent_at: "2026-10-26T01:00:00Z", first_sent_version_no: 2,
    versions: [
      { id: "v2", version_no: 2, prepared_at: "2026-10-20T01:00:00Z", issued_at: "2026-10-23T07:00:00Z", total_amount: 950, currency: "MYR", external_ref: "SQ-SYN-1", valid_until: null, evidence_state: "staff_entered", notes: null,
        sends: [{ id: "d1", sent_at: "2026-10-26T01:00:00Z", recorded_at: "2026-10-26T01:00:00Z", channel: "whatsapp", evidence: "staff_attested", evidence_ref: null, note: null, sent_by_name: "Synthetic Rep", recorded_by_name: "Synthetic Rep", kind: "first_quote", voided: null }] },
      { id: "v1", version_no: 1, prepared_at: "2026-10-19T01:00:00Z", issued_at: null, total_amount: 1000, currency: "MYR", external_ref: "SQ-SYN-1", valid_until: null, evidence_state: "staff_entered", notes: null, sends: [] },
    ],
    events: [],
  }],
  evidence: [{ evidence_key: "reference:visit-1", visit_id: "visit-1", evidence_kind: "reference", file_id: null, reference_text: "SQ-SYN-1", amount: 1000, file_name: null, resolution: "matched", quote_id: "q1", decided_version_id: null, decision_id: null, decision_reason: null, changed_since_decision: false }],
};

beforeEach(() => { vi.resetAllMocks(); mocks.load.mockResolvedValue({ ok: true, data: ctx }); });

describe("QuotePanel", () => {
  it("shows prepared, issued and sent as different facts and how the send counts", async () => {
    wrap();
    const card = await screen.findByRole("listitem", { name: "Quote QT-SYN-1" });
    expect(within(card).getByText("Sent")).toBeVisible();
    expect(within(card).getByText("First sent as v2", { exact: false })).toBeVisible();
    expect(within(card).getByText("First quotation")).toBeVisible();
    expect(within(card).getAllByText("Prepared").length).toBeGreaterThan(0);
    expect(within(card).getByRole("button", { name: "Issue v1" })).toBeVisible();
    expect(within(card).getByRole("link", { name: "Visit" })).toHaveAttribute("href", "/sales/walk-ins?visit=visit-1");
    expect(screen.getByText("Matched by SQ number")).toBeVisible();
  });

  it("retries an unchanged form with the same request id and starts a new one after an edit", async () => {
    const user = userEvent.setup();
    mocks.command.mockResolvedValueOnce({ ok: false, error: "Network timeout" }).mockResolvedValueOnce({ ok: false, error: "Network timeout" }).mockResolvedValue({ ok: true, data: {}, message: "Version issued." });
    wrap();
    await user.click(await screen.findByRole("button", { name: "Issue v1" }));
    await user.click(screen.getByRole("button", { name: "Issue version" }));
    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: "Retry: issue version" }));
    await waitFor(() => expect(mocks.command).toHaveBeenCalledTimes(2));
    expect(mocks.command.mock.calls[0][0].request_id).toBe(mocks.command.mock.calls[1][0].request_id);
    await user.clear(screen.getByLabelText(/Issued/));
    await user.type(screen.getByLabelText(/Issued/), "2026-10-23T15:00");
    await user.click(screen.getByRole("button", { name: "Retry: issue version" }));
    await waitFor(() => expect(mocks.command).toHaveBeenCalledTimes(3));
    expect(mocks.command.mock.calls[2][0].request_id).not.toBe(mocks.command.mock.calls[1][0].request_id);
    await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(2));
  });

  it("explains disabled quote actions for a role without sales.write", async () => {
    wrap(["sales.read"]);
    expect(await screen.findByRole("button", { name: "Record quote" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Mark sent" })).toBeDisabled();
  });
});
