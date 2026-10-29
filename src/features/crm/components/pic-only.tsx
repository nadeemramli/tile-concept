"use client";

import * as React from "react";
import { DisabledHint } from "@/components/patterns/explain";
import { useSession } from "@/components/shell/session-context";
import type { MemberOption } from "@/features/crm/components/selects";

/** Why a customer-card edit is unavailable, or null when the session is the card's PIC. */
export function usePicLock(ownerId: string | null, members: MemberOption[]): string | null {
  const { session } = useSession();
  if (ownerId && ownerId === session.userId) return null;
  if (!ownerId) return "This card has no PIC yet, so nobody can edit it. A sales manager assigns one with Transfer PIC.";
  const name = members.find((m) => m.user_id === ownerId)?.full_name ?? "its PIC";
  return `Only ${name}, the PIC of this card, can edit it. A sales manager can transfer the card to you with Transfer PIC.`;
}

/**
 * Renders a card-editing control as-is for the card's PIC; for anyone else the
 * same control, disabled, with who can edit. The database enforces the same
 * rule, so this only saves a refused round trip.
 */
export function PicOnly({ lock, children }: { lock: string | null; children: React.ReactElement<{ disabled?: boolean }> }) {
  if (!lock) return children;
  return <DisabledHint reason={{ title: "Read-only for you", body: lock }}>{React.cloneElement(children, { disabled: true })}</DisabledHint>;
}
