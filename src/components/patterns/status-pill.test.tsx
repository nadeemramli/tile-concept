import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipProvider } from "@/components/ui/tooltip";
import { StatusPill, TonePill } from "@/components/patterns/status-pill";
import * as MAPS from "@/lib/domain/status-maps";
import { LEAD_STATUS, PRICE_STATE, type StatusMap } from "@/lib/domain/status-maps";
import { BOOKING_STATUS, CONTENT_STATUS, OUTPUT_STATE, PERMISSION_STATUS, READINESS_STATE } from "@/features/marketing/lib/status";
import { AVAILABILITY_STATUS, CASE_STATUS, FRESHNESS_STATUS, MAPPING_STATUS, SOURCE_KIND } from "@/features/stock/status";
import { ASSET_KIND, ASSET_STATUS, ITEM_TYPE, JOB_STATUS, REVIEW_ITEM_STATUS } from "@/features/sources/status-maps";
import { INTAKE_STATUS } from "@/features/connectors/status";

function wrap(ui: React.ReactNode) {
  return render(<TooltipProvider delayDuration={0}>{ui}</TooltipProvider>);
}

describe("StatusPill", () => {
  it("shows the map hint on focus", async () => {
    const user = userEvent.setup();
    wrap(<StatusPill map={PRICE_STATE} value="superseded" />);
    expect(screen.getByText("Superseded")).toBeInTheDocument();
    await user.tab();
    expect(await screen.findByRole("tooltip")).toHaveTextContent(PRICE_STATE.superseded.hint!);
  });

  it("renders without a hint when asked to", async () => {
    const user = userEvent.setup();
    wrap(<StatusPill map={PRICE_STATE} value="superseded" hint={false} />);
    await user.tab();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("falls back to a readable label for unknown values", () => {
    wrap(<StatusPill map={LEAD_STATUS} value="some_new_state" />);
    expect(screen.getByText("some new state")).toBeInTheDocument();
  });

  it("lets TonePill carry an ad-hoc hint", async () => {
    const user = userEvent.setup();
    wrap(<TonePill tone="warning" label="Blocking" hint="Needs an override." />);
    await user.tab();
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Needs an override.");
  });
});

/**
 * Every status a person can meet on screen must explain itself. This guards
 * against a new map entry landing without a hint.
 */
describe("every status map entry has a hint", () => {
  const shared = Object.entries(MAPS).filter(([, v]) => v && typeof v === "object" && !Array.isArray(v) && Object.values(v).every((m) => m && typeof m === "object" && "label" in (m as object))) as [string, StatusMap][];
  const local: [string, Record<string, { label: string; hint?: string }>][] = [
    ["BOOKING_STATUS", BOOKING_STATUS],
    ["PERMISSION_STATUS", PERMISSION_STATUS],
    ["READINESS_STATE", READINESS_STATE],
    ["CONTENT_STATUS", CONTENT_STATUS],
    ["OUTPUT_STATE", OUTPUT_STATE],
    ["AVAILABILITY_STATUS", AVAILABILITY_STATUS],
    ["SOURCE_KIND", SOURCE_KIND],
    ["FRESHNESS_STATUS", FRESHNESS_STATUS],
    ["MAPPING_STATUS", MAPPING_STATUS],
    ["CASE_STATUS", CASE_STATUS],
    ["ASSET_STATUS", ASSET_STATUS],
    ["ASSET_KIND", ASSET_KIND],
    ["JOB_STATUS", JOB_STATUS],
    ["REVIEW_ITEM_STATUS", REVIEW_ITEM_STATUS],
    ["ITEM_TYPE", ITEM_TYPE],
    ["INTAKE_STATUS", INTAKE_STATUS],
  ];
  for (const [name, map] of [...shared, ...local]) {
    if (name === "TONE_CLASSES" || name === "TONE_DOT_CLASSES" || name === "STAGE_GROUP_TONE") continue;
    it(`${name}`, () => {
      const missing = Object.entries(map)
        .filter(([, m]) => !m.hint || m.hint.trim().length < 12)
        .map(([k]) => k);
      expect(missing, `${name} entries without a hint: ${missing.join(", ")}`).toEqual([]);
    });
  }
});
