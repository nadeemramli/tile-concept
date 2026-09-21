import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NewInquiryDialog } from "./new-inquiry-dialog";

const mock = vi.hoisted(() => ({ create: vi.fn(), error: vi.fn(), success: vi.fn() }));
vi.mock("@/server/commands/leads", () => ({ createInquiryAction: mock.create }));
vi.mock("@/components/shell/session-context", () => ({ useSession: () => ({ can: () => false }) }));
vi.mock("sonner", () => ({ toast: { error: mock.error, success: mock.success, info: vi.fn() } }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("manual inquiry save recovery", () => {
  it("reuses the request ID after an uncertain result and explains ambiguous identity", async () => {
    const user = userEvent.setup();
    const created = vi.fn();
    mock.create.mockRejectedValueOnce(new Error("Network unavailable")).mockResolvedValueOnce({ ok: true, message: "Saved for review", data: {
      lead_id: "eeeeeeee-2109-0015-0100-000000000001", identity_state: "needs_review", suggestions: [],
    } });
    render(<NewInquiryDialog open onOpenChange={vi.fn()} members={[]} locations={[]} defaultLocationId={null}
      defaultOwnerId="aaaaaaaa-0000-0000-0000-000000000003" onCreated={created} />);
    await user.type(screen.getByRole("textbox", { name: "Name" }), "Recovery fixture");
    await user.click(await screen.findByRole("button", { name: "Save inquiry" }));
    await waitFor(() => expect(mock.error).toHaveBeenCalledWith(expect.stringContaining("Retry with the same fields")));
    await user.click(await screen.findByRole("button", { name: "Save inquiry" }));
    await waitFor(() => expect(created).toHaveBeenCalledOnce());
    expect(mock.create).toHaveBeenCalledTimes(2);
    expect(mock.create.mock.calls[0][1]).toBe(mock.create.mock.calls[1][1]);
    expect(screen.getByText(/identifiers are shared, conflicting or provisional/)).toBeInTheDocument();
    expect(screen.queryByText(/Linked to the uniquely matched customer/)).not.toBeInTheDocument();
  });
});
