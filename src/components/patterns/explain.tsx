"use client";

import * as React from "react";
import Link from "next/link";
import { Info, Lock } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSession } from "@/components/shell/session-context";
import { PERMISSION_EXPLAINERS, type PermissionKey } from "@/lib/rbac/matrix";
import { cn } from "@/lib/utils";

/**
 * One way to explain things (PRD §9.2, §12.2). Every status, column, filter,
 * disabled control and permission gate reads its explanation through these so
 * the wording lives once, next to the data that defines it.
 *
 * - `Hint`         — a tooltip around any trigger. Opens on hover and on focus.
 * - `InfoTip`      — the ⓘ button for headers, labels and filter buttons.
 * - `DisabledHint` — a disabled control with the rule that disables it.
 * - `Gated`        — a control the current role may lack; shows disabled with
 *                    the role that can, instead of vanishing.
 */

export interface RichHint {
  title?: string;
  body: React.ReactNode;
  /** Optional deep link, usually into Help & glossary. */
  action?: { label: string; href: string };
}

export type HintContent = string | RichHint | null | undefined | false;

function isRich(c: HintContent): c is RichHint {
  return typeof c === "object" && c !== null && "body" in c;
}

const FOCUS_RING = "rounded outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function Hint({
  content,
  children,
  side,
  align,
  className,
  focusable = false,
}: {
  content: HintContent;
  children: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  className?: string;
  /** Wrap the child in a focusable span so keyboard users reach the hint even when the child is not interactive. */
  focusable?: boolean;
}) {
  if (!content) return <>{children}</>;
  const trigger = focusable ? (
    <span tabIndex={0} className={cn("inline-flex max-w-full", FOCUS_RING)}>
      {children}
    </span>
  ) : (
    children
  );
  return (
    <Tooltip>
      <TooltipTrigger asChild>{trigger}</TooltipTrigger>
      <TooltipContent side={side} align={align} className={cn("max-w-72 whitespace-normal text-left leading-snug", className)}>
        {isRich(content) ? (
          <span className="block space-y-1">
            {content.title && <span className="block font-medium">{content.title}</span>}
            <span className="block">{content.body}</span>
            {content.action && (
              <Link href={content.action.href} className="block underline underline-offset-2 opacity-90 hover:opacity-100">
                {content.action.label}
              </Link>
            )}
          </span>
        ) : (
          content
        )}
      </TooltipContent>
    </Tooltip>
  );
}

/** The ⓘ affordance. `label` names what is being explained for screen readers. */
export function InfoTip({ content, label, className, side }: { content: HintContent; label: string; className?: string; side?: "top" | "right" | "bottom" | "left" }) {
  if (!content) return null;
  return (
    <Hint content={content} side={side}>
      <button
        type="button"
        aria-label={`About ${label}`}
        className={cn("inline-flex shrink-0 align-middle text-muted-foreground/70 hover:text-foreground", FOCUS_RING, className)}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        <Info className="size-3.5" aria-hidden />
      </button>
    </Hint>
  );
}

/**
 * Disabled buttons do not receive pointer or focus events, so the hint sits on
 * a focusable wrapper. Pass the rule that is unmet, in the user's words.
 */
export function DisabledHint({ reason, children, className, side }: { reason: HintContent; children: React.ReactNode; className?: string; side?: "top" | "right" | "bottom" | "left" }) {
  return (
    <Hint content={reason} focusable className={className} side={side}>
      {children}
    </Hint>
  );
}

/** Sentence used wherever an action needs a permission the current role lacks. */
export function gateReason(permission: PermissionKey, roleLabel?: string): string {
  const who = PERMISSION_EXPLAINERS[permission] ?? "Your role does not include this action.";
  return roleLabel ? `Not available to ${roleLabel}. ${who}` : who;
}

/**
 * Renders the child as-is when the session holds `permission`; otherwise the
 * same control, disabled, with the role that can perform it. The child must be
 * a single element that accepts `disabled` (a Button, Checkbox or input).
 */
export function Gated({ permission, children, className, side }: { permission: PermissionKey; children: React.ReactElement<{ disabled?: boolean }>; className?: string; side?: "top" | "right" | "bottom" | "left" }) {
  const { can, session } = useSession();
  if (can(permission)) return children;
  return (
    <DisabledHint reason={{ title: "Needs a different role", body: gateReason(permission, session.roleLabel) }} className={className} side={side}>
      {React.cloneElement(children, { disabled: true })}
    </DisabledHint>
  );
}

/** Small lock glyph for inline "you can see this, not change it" cues. */
export function GateGlyph({ permission, className }: { permission: PermissionKey; className?: string }) {
  const { can, session } = useSession();
  if (can(permission)) return null;
  return (
    <Hint content={gateReason(permission, session.roleLabel)} focusable>
      <Lock className={cn("size-3 text-muted-foreground", className)} aria-label="Read only for your role" />
    </Hint>
  );
}
