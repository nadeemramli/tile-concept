/** Only configured Google destinations; never redirect a customer to an arbitrary URL. */
export function googleDestination(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  try {
    const url = new URL(raw.trim());
    const host = url.hostname.toLowerCase();
    const allowed = host === "share.google" || host === "g.page" || host === "maps.app.goo.gl" || host === "google.com" || host.endsWith(".google.com");
    if (url.protocol !== "https:" || !allowed || url.username || url.password || url.port) return null;
    return url.toString();
  } catch { return null; }
}
export function isGoogleListingLink(raw: string | null | undefined): boolean {
  const valid = googleDestination(raw);
  if (!valid) return false;
  const url = new URL(valid);
  return url.hostname === "share.google" || url.hostname === "maps.app.goo.gl" || url.pathname === "/search" || url.pathname.startsWith("/maps");
}
