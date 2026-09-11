import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SessionProvider } from "@/components/shell/session-context";
import { DisabledHint, Gated, Hint, InfoTip, gateReason } from "@/components/patterns/explain";
import type { AppSession } from "@/server/session";

function session(permissions: string[], roleLabel = "Sales representative"): AppSession {
  return {
    userId: "u1",
    email: "rep@example.test",
    fullName: "Rep",
    workspaceId: "w1",
    workspaceName: "Demo",
    roleKey: "sales_rep",
    roleLabel,
    permissions,
  } as unknown as AppSession;
}

function wrap(ui: React.ReactNode, perms: string[] = []) {
  return render(
    <SessionProvider session={session(perms)}>
      <TooltipProvider delayDuration={0}>{ui}</TooltipProvider>
    </SessionProvider>,
  );
}

describe("Hint", () => {
  it("renders the child alone when there is no content", () => {
    wrap(
      <Hint content={undefined}>
        <button type="button">Plain</button>
      </Hint>,
    );
    expect(screen.getByRole("button", { name: "Plain" })).toBeInTheDocument();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("opens on keyboard focus and shows the text", async () => {
    const user = userEvent.setup();
    wrap(
      <Hint content="Crew capacity is not committed.">
        <button type="button">Tentative hold</button>
      </Hint>,
    );
    await user.tab();
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Crew capacity is not committed.");
  });

  it("makes a non-interactive child reachable when focusable is set", async () => {
    const user = userEvent.setup();
    wrap(
      <Hint content="Held in reserve." focusable>
        <span>Standby</span>
      </Hint>,
    );
    await user.tab();
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Held in reserve.");
  });

  it("renders a rich hint with title, body and link", async () => {
    const user = userEvent.setup();
    wrap(
      <Hint content={{ title: "Customer media permission", body: "Not requested yet.", action: { label: "Read more", href: "/platform/help#customer-media-permission" } }}>
        <button type="button">Chip</button>
      </Hint>,
    );
    await user.tab();
    const tip = await screen.findByRole("tooltip");
    expect(tip).toHaveTextContent("Customer media permission");
    expect(tip).toHaveTextContent("Not requested yet.");
    expect(tip.querySelector("a")?.getAttribute("href")).toBe("/platform/help#customer-media-permission");
  });
});

describe("InfoTip", () => {
  it("is a labelled button that explains on focus", async () => {
    const user = userEvent.setup();
    wrap(<InfoTip label="Exceptions only" content="Bookings that need attention." />);
    const btn = screen.getByRole("button", { name: "About Exceptions only" });
    await user.tab();
    expect(btn).toHaveFocus();
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Bookings that need attention.");
  });
});

describe("DisabledHint", () => {
  it("keeps the control disabled and explains the rule", async () => {
    const user = userEvent.setup();
    wrap(
      <DisabledHint reason="Reason needs at least 5 characters.">
        <button type="button" disabled>
          Save
        </button>
      </DisabledHint>,
    );
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await user.tab();
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Reason needs at least 5 characters.");
  });
});

describe("Gated", () => {
  it("renders the child untouched when the role holds the permission", () => {
    wrap(
      <Gated permission="marketing.confirm">
        <button type="button">Confirm</button>
      </Gated>,
      ["marketing.confirm"],
    );
    expect(screen.getByRole("button", { name: "Confirm" })).toBeEnabled();
  });

  it("disables the child and names the role that can when the permission is missing", async () => {
    const user = userEvent.setup();
    wrap(
      <Gated permission="marketing.confirm">
        <button type="button">Confirm</button>
      </Gated>,
      ["marketing.write"],
    );
    expect(screen.getByRole("button", { name: "Confirm" })).toBeDisabled();
    await user.tab();
    const tip = await screen.findByRole("tooltip");
    expect(tip).toHaveTextContent("Not available to Sales representative.");
    expect(tip).toHaveTextContent("marketing coordinators");
  });
});

describe("gateReason", () => {
  it("names the role and who can", () => {
    expect(gateReason("marketing.confirm", "Sales representative")).toMatch(/^Not available to Sales representative\. .*marketing coordinators/);
    expect(gateReason("settings.manage")).toMatch(/administrators/);
  });
});
