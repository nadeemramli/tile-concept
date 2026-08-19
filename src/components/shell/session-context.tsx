"use client";

import { createContext, useContext, useMemo } from "react";
import type { AppSession } from "@/server/session";
import type { PermissionKey } from "@/lib/rbac/matrix";

interface SessionValue {
  session: AppSession;
  permissions: Set<string>;
  can: (p: PermissionKey) => boolean;
}

const Ctx = createContext<SessionValue | null>(null);

export function SessionProvider({ session, children }: { session: AppSession; children: React.ReactNode }) {
  const value = useMemo<SessionValue>(() => {
    const permissions = new Set(session.permissions);
    return { session, permissions, can: (p) => permissions.has(p) };
  }, [session]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSession must be used within SessionProvider");
  return v;
}
