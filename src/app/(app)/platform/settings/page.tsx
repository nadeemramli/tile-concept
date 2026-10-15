import { getLeadRouting } from "@/server/queries/lead-routing";
import type { Metadata } from "next";
import { hasPermission, requireSession } from "@/server/session";
import { PageBody, PageHeader } from "@/components/patterns/page-header";
import { PermissionDenied } from "@/components/patterns/states";
import { getRolesMatrix, getWorkspace, listAllLocations, listFeatureFlags, listInvites, listSharedViews, listStagesAdmin, listUsers } from "@/server/queries/platform";
import { SettingsTabs } from "@/features/platform/components/settings";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const session = await requireSession();
  if (!hasPermission(session, "settings.manage")) return <PermissionDenied permission="settings.manage" roleLabel={session.roleLabel} />;
  const [users, invites, matrix, workspace, locations, stages, views, flags, routing] = await Promise.all([listUsers(), listInvites(), getRolesMatrix(), getWorkspace(), listAllLocations(), listStagesAdmin(), listSharedViews(), listFeatureFlags(), getLeadRouting()]);
  return (
    <PageBody>
      <PageHeader title="Settings" description="Users, invitations, role matrix, workspace, locations, opportunity stages, shared views, feature flags and lead routing." />
      <SettingsTabs data={{ users, invites, roles: matrix.roles, permissions: matrix.permissions, rolePerms: [...matrix.has], workspace, locations, stages, views, flags, routing, currentUserId: session.userId }} />
    </PageBody>
  );
}
