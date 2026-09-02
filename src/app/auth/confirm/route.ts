import { NextResponse, type NextRequest } from "next/server";

/**
 * Compatibility route for older email templates. A GET must never consume the
 * one-time token because mail security scanners routinely prefetch links.
 */
export async function GET(request: NextRequest) {
  const destination = request.nextUrl.clone();
  if (!destination.searchParams.get("token_hash") || !destination.searchParams.get("type")) {
    destination.pathname = "/login";
    destination.search = "?reason=invalid-link";
    return NextResponse.redirect(destination);
  }
  destination.pathname = "/auth/accept";
  return NextResponse.redirect(destination);
}
