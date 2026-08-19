import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * Brand assets. The logo lockup is a wordmark, so it is only used where it can
 * actually be read (login, invite screens). Small chrome — sidebar, avatars —
 * uses the monogram, which echoes the lockup: amber on brand navy.
 */

export function LogoMark({ className, title = "Tile Concept" }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 32 32" role="img" aria-label={title} className={cn("size-7 shrink-0", className)}>
      <rect width="32" height="32" rx="7" fill="var(--brand-navy)" />
      <text
        x="16"
        y="22.4"
        textAnchor="middle"
        fill="#eda537"
        fontFamily="var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif"
        fontSize="16"
        fontWeight="700"
        letterSpacing="-0.6"
      >
        tc
      </text>
    </svg>
  );
}

export function LogoLockup({ size = 72, className, priority }: { size?: number; className?: string; priority?: boolean }) {
  return (
    <Image
      src="/brand/tile-concept-logo.png"
      alt="Tile Concept"
      width={size}
      height={size}
      priority={priority}
      className={cn("rounded-xl", className)}
    />
  );
}
