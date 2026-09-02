type AuthErrorLike = { code?: string; message?: string };

const UNCONFIRMED_INVITE_CODES = new Set(["signup_disabled", "otp_disabled", "email_not_confirmed"]);

/**
 * An invited-but-unconfirmed user is present in Auth, but GoTrue still routes a
 * magic-link request through signup. Invite-only projects reject that request.
 * In that one case the supported recovery is to resend the existing signup
 * confirmation, which does not create a new account.
 */
export function shouldResendSignupConfirmation(error: AuthErrorLike) {
  if (error.code && UNCONFIRMED_INVITE_CODES.has(error.code)) return true;
  const message = error.message?.toLowerCase() ?? "";
  return message.includes("signups not allowed") || message.includes("email not confirmed");
}

export function emailLinkErrorMessage(error: AuthErrorLike) {
  const code = error.code ?? "";
  const message = error.message?.toLowerCase() ?? "";
  if (code.includes("rate_limit") || message.includes("rate limit") || message.includes("seconds")) {
    return "A link was requested recently. Please wait a minute, then try again.";
  }
  return "We could not send an access link right now. Please try again shortly.";
}

/** Only allow an in-app path to be used after an authentication exchange. */
export function safeAuthNext(value: unknown, fallback = "/") {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return fallback;
  try {
    const parsed = new URL(value, "https://tile-concept.invalid");
    if (parsed.origin !== "https://tile-concept.invalid") return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}
