import "server-only";

import { createHash } from "node:crypto";

export function hashFeedbackToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

