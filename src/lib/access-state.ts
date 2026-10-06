/**
 * Why a signed-in account has no workspace, as reported by api.claim_my_invites().
 *
 * "active" never reaches the no-access page; it is here so the parser accepts
 * every value the function returns. Anything unrecognised (including the RPC
 * being unavailable) is treated as "none", which is the advice that is always
 * safe to give: ask an administrator for an invitation.
 */
export type AccessState = "active" | "suspended" | "unconfirmed" | "none";

const STATES: readonly AccessState[] = ["active", "suspended", "unconfirmed", "none"];

export function toAccessState(value: unknown): AccessState {
  return STATES.includes(value as AccessState) ? (value as AccessState) : "none";
}

export const NO_ACCESS_COPY: Record<Exclude<AccessState, "active">, { title: string; body: (email: string) => string }> = {
  none: {
    title: "No workspace access yet",
    body: (email) =>
      `You are signed in as ${email}, but this account is not a member of any Tile Concept workspace. Ask a platform administrator to invite this exact address from Settings → Invites. Once they have, choose Check again — you do not need a new email link.`,
  },
  suspended: {
    title: "Access suspended",
    body: (email) =>
      `You are signed in as ${email}, but an administrator has suspended this account's workspace membership. Ask a platform administrator to reactivate it from Settings → Users.`,
  },
  unconfirmed: {
    title: "Email address not confirmed",
    body: (email) =>
      `You are signed in as ${email}, but this address has not been confirmed yet. Open the most recent invitation or sign-in link sent to it, then choose Check again.`,
  },
};
