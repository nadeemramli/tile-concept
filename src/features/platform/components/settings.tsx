"use client";

import { useState } from "react";
import { parseAsString, useQueryState } from "nuqs";
import { ArrowDown, ArrowUp, Check, Mail, Plus, Send } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/patterns/field";
import { TonePill } from "@/components/patterns/status-pill";
import { EmptyState } from "@/components/patterns/states";
import { formatDateTime } from "@/lib/format";
import { ROLE_LABELS, type RoleKey } from "@/lib/rbac/matrix";
import { SimpleSelect } from "@/features/catalog/components/selects";
import { fieldError, useAction } from "@/features/catalog/use-action";
import {
  changeMemberRoleAction,
  deleteSharedViewAction,
  inviteUserAction,
  moveStageAction,
  resendInviteAction,
  revokeInviteAction,
  setFeatureFlagAction,
  setLocationActiveAction,
  setMemberLocationAction,
  setMemberStatusAction,
  updateStageAction,
  updateWorkspaceAction,
  upsertLocationAction,
  upsertSharedViewAction,
} from "@/server/commands/platform";
import type { getRolesMatrix, listAllLocations, listFeatureFlags, listInvites, listSharedViews, listStagesAdmin, listUsers, getWorkspace } from "@/server/queries/platform";

export interface SettingsData {
  users: Awaited<ReturnType<typeof listUsers>>;
  invites: Awaited<ReturnType<typeof listInvites>>;
  roles: Awaited<ReturnType<typeof getRolesMatrix>>["roles"];
  permissions: string[];
  rolePerms: string[]; // "role:perm"
  workspace: Awaited<ReturnType<typeof getWorkspace>>;
  locations: Awaited<ReturnType<typeof listAllLocations>>;
  stages: Awaited<ReturnType<typeof listStagesAdmin>>;
  views: Awaited<ReturnType<typeof listSharedViews>>;
  flags: Awaited<ReturnType<typeof listFeatureFlags>>;
  currentUserId: string;
}

const TABS = [
  { key: "users", label: "Users" },
  { key: "invites", label: "Invites" },
  { key: "roles", label: "Roles" },
  { key: "workspace", label: "Workspace" },
  { key: "locations", label: "Locations" },
  { key: "stages", label: "Stages" },
  { key: "views", label: "Saved views" },
  { key: "flags", label: "Feature flags" },
];

const roleOpts = Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label }));

export function SettingsTabs({ data }: { data: SettingsData }) {
  const [tab, setTab] = useQueryState("tab", parseAsString.withDefault("users"));
  return (
    <div className="space-y-4">
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList variant="line" className="flex-wrap">
          {TABS.map((t) => (
            <TabsTrigger key={t.key} value={t.key}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {tab === "users" && <UsersTab data={data} />}
      {tab === "invites" && <InvitesTab data={data} />}
      {tab === "roles" && <RolesTab data={data} />}
      {tab === "workspace" && <WorkspaceTab data={data} />}
      {tab === "locations" && <LocationsTab data={data} />}
      {tab === "stages" && <StagesTab data={data} />}
      {tab === "views" && <ViewsTab data={data} />}
      {tab === "flags" && <FlagsTab data={data} />}
    </div>
  );
}

/* ---------------- users ---------------- */
function UsersTab({ data }: { data: SettingsData }) {
  const role = useAction(changeMemberRoleAction);
  const status = useAction(setMemberStatusAction);
  const loc = useAction(setMemberLocationAction);
  const locOpts = data.locations.filter((l) => l.is_active).map((l) => ({ value: l.id, label: l.name }));
  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="h-9 text-xs">Name</TableHead>
            <TableHead className="h-9 text-xs">Email</TableHead>
            <TableHead className="h-9 text-xs">Role</TableHead>
            <TableHead className="h-9 text-xs">Default location</TableHead>
            <TableHead className="h-9 text-xs">Status</TableHead>
            <TableHead className="h-9 text-xs">Joined</TableHead>
            <TableHead className="h-9 text-xs" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.users.map((u) => (
            <TableRow key={u.id}>
              <TableCell className="py-1.5 text-[13px] font-medium">
                {u.full_name}
                {u.user_id === data.currentUserId && <span className="ml-1 text-[11px] text-muted-foreground">(you)</span>}
              </TableCell>
              <TableCell className="py-1.5 text-[13px]">{u.email}</TableCell>
              <TableCell className="py-1.5">
                <div className="w-52">
                  <SimpleSelect value={u.role_key} onChange={(v) => v && role.run(u.id, v)} options={roleOpts} allowNone={false} disabled={role.pending} />
                </div>
              </TableCell>
              <TableCell className="py-1.5">
                <div className="w-44">
                  <SimpleSelect value={u.default_location_id ?? ""} onChange={(v) => loc.run(u.id, v || null)} options={locOpts} noneLabel="None" disabled={loc.pending} />
                </div>
              </TableCell>
              <TableCell className="py-1.5">
                <TonePill tone={u.status === "active" ? "success" : "warning"} label={u.status} />
              </TableCell>
              <TableCell className="tnum py-1.5 text-[13px] text-muted-foreground">{formatDateTime(u.created_at)}</TableCell>
              <TableCell className="py-1.5">
                {u.user_id !== data.currentUserId && (
                  <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" disabled={status.pending} onClick={() => status.run(u.id, u.status === "active" ? "suspended" : "active")}>
                    {u.status === "active" ? "Suspend" : "Reactivate"}
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/* ---------------- invites ---------------- */
function InvitesTab({ data }: { data: SettingsData }) {
  const [f, setF] = useState({ email: "", full_name: "", role_key: "sales_rep" as RoleKey, default_location_id: "" });
  const invite = useAction(inviteUserAction, { onSuccess: () => setF({ email: "", full_name: "", role_key: "sales_rep", default_location_id: "" }) });
  const revoke = useAction(revokeInviteAction);
  const resend = useAction(resendInviteAction, { refresh: false });
  const locOpts = data.locations.filter((l) => l.is_active).map((l) => ({ value: l.id, label: l.name }));
  return (
    <div className="space-y-4">
      <Card className="px-4 py-3">
        <form
          className="grid items-end gap-3 md:grid-cols-5"
          onSubmit={(e) => {
            e.preventDefault();
            invite.run(f);
          }}
        >
          <Field label="Email" required error={fieldError(invite.fieldErrors, "email")}>
            <Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} className="h-8" />
          </Field>
          <Field label="Full name">
            <Input value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} className="h-8" />
          </Field>
          <Field label="Role" required>
            <SimpleSelect value={f.role_key} onChange={(v) => setF({ ...f, role_key: v as RoleKey })} options={roleOpts} allowNone={false} />
          </Field>
          <Field label="Default location">
            <SimpleSelect value={f.default_location_id} onChange={(v) => setF({ ...f, default_location_id: v })} options={locOpts} />
          </Field>
          <Button type="submit" size="sm" className="h-8 gap-1.5" disabled={invite.pending || !f.email}>
            <Mail className="size-3.5" aria-hidden /> {invite.pending ? "Inviting…" : "Invite user"}
          </Button>
        </form>
        <p className="mt-2 text-[11px] text-muted-foreground">Sends a Supabase Auth invitation. Membership is created automatically with this role when the invitee accepts. Invite-only: there is no public signup.</p>
      </Card>
      {data.invites.length === 0 ? (
        <EmptyState title="No invitations yet" description="Invite staff by email; they receive a link to set a password." />
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="h-9 text-xs">Email</TableHead>
                <TableHead className="h-9 text-xs">Role</TableHead>
                <TableHead className="h-9 text-xs">Status</TableHead>
                <TableHead className="h-9 text-xs">Invited</TableHead>
                <TableHead className="h-9 text-xs">Accepted</TableHead>
                <TableHead className="h-9 text-xs" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.invites.map((i) => (
                <TableRow key={i.id}>
                  <TableCell className="py-1.5 text-[13px]">{i.email}</TableCell>
                  <TableCell className="py-1.5 text-[13px]">{ROLE_LABELS[i.role_key as RoleKey] ?? i.role_key}</TableCell>
                  <TableCell className="py-1.5">
                    <TonePill tone={i.status === "accepted" ? "success" : i.status === "pending" ? "info" : "neutral"} label={i.status} />
                  </TableCell>
                  <TableCell className="tnum py-1.5 text-[13px] text-muted-foreground">
                    {formatDateTime(i.created_at)}
                    {i.invited_by_name ? ` · ${i.invited_by_name}` : ""}
                  </TableCell>
                  <TableCell className="tnum py-1.5 text-[13px] text-muted-foreground">{i.accepted_at ? formatDateTime(i.accepted_at) : "—"}</TableCell>
                  <TableCell className="py-1.5">
                    {i.status === "pending" && (
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" className="h-6 gap-1 px-2 text-xs" disabled={resend.pending} onClick={() => resend.run(i.id)}>
                          <Send className="size-3" aria-hidden /> Resend
                        </Button>
                        <Button size="sm" variant="ghost" className="h-6 px-2 text-xs text-muted-foreground" disabled={revoke.pending} onClick={() => revoke.run(i.id)}>
                          Revoke
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

/* ---------------- roles ---------------- */
function RolesTab({ data }: { data: SettingsData }) {
  const has = new Set(data.rolePerms);
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">Permissions are action-based and enforced in the database (<code className="font-mono text-xs">core.role_permissions</code>). This matrix is read-only; changes go through a reviewed migration.</p>
      <div className="overflow-x-auto rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="sticky left-0 z-10 h-9 bg-card text-xs">Permission</TableHead>
              {data.roles.map((r) => (
                <TableHead key={r.key} className="h-9 text-center text-xs" title={r.description ?? ""}>
                  {r.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.permissions.map((p) => (
              <TableRow key={p}>
                <TableCell className="sticky left-0 z-10 bg-card py-1 font-mono text-[12px]">{p}</TableCell>
                {data.roles.map((r) => (
                  <TableCell key={r.key} className="py-1 text-center">
                    {has.has(`${r.key}:${p}`) ? <Check className="mx-auto size-3.5 text-success" aria-label="granted" /> : <span className="text-muted-foreground/40">·</span>}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

/* ---------------- workspace ---------------- */
function WorkspaceTab({ data }: { data: SettingsData }) {
  const ws = data.workspace;
  const [f, setF] = useState({ name: ws?.name ?? "", timezone: ws?.timezone ?? "Asia/Kuala_Lumpur", default_currency: ws?.default_currency ?? "MYR" });
  const save = useAction(updateWorkspaceAction);
  if (!ws) return <EmptyState title="No workspace" description="No workspace row is visible to your membership." />;
  return (
    <Card className="max-w-xl px-4 py-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" required className="sm:col-span-2">
          <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Timezone (IANA)" hint="Bookings store UTC + this zone">
          <Input value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })} className="font-mono" />
        </Field>
        <Field label="Default currency">
          <Input value={f.default_currency} onChange={(e) => setF({ ...f, default_currency: e.target.value.toUpperCase() })} maxLength={3} className="font-mono uppercase" />
        </Field>
        <div className="text-xs text-muted-foreground sm:col-span-2">
          Slug: <code className="font-mono">{ws.slug}</code>
        </div>
      </div>
      <div className="mt-3 flex justify-end">
        <Button size="sm" disabled={save.pending} onClick={() => save.run(ws.id, f)}>
          {save.pending ? "Saving…" : "Save workspace"}
        </Button>
      </div>
    </Card>
  );
}

/* ---------------- locations ---------------- */
function LocationsTab({ data }: { data: SettingsData }) {
  const LOCATION_KINDS = ["showroom", "office", "warehouse", "site", "other"] as const;
  type LocationKind = (typeof LOCATION_KINDS)[number];
  const empty = { id: "", code: "", name: "", kind: "showroom" as LocationKind, city: "", state: "" };
  const [editing, setEditing] = useState<typeof empty | null>(null);
  const upsert = useAction(upsertLocationAction, { onSuccess: () => setEditing(null) });
  const active = useAction(setLocationActiveAction);
  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" className="h-8 gap-1.5" onClick={() => setEditing(empty)}>
          <Plus className="size-3.5" aria-hidden /> Add location
        </Button>
      </div>
      <div className="overflow-x-auto rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="h-9 text-xs">Code</TableHead>
              <TableHead className="h-9 text-xs">Name</TableHead>
              <TableHead className="h-9 text-xs">Kind</TableHead>
              <TableHead className="h-9 text-xs">City / state</TableHead>
              <TableHead className="h-9 text-xs">Active</TableHead>
              <TableHead className="h-9 text-xs" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.locations.map((l) => (
              <TableRow key={l.id}>
                <TableCell className="py-1.5 font-mono text-[12px]">{l.code}</TableCell>
                <TableCell className="py-1.5 text-[13px] font-medium">{l.name}</TableCell>
                <TableCell className="py-1.5 text-[13px]">{l.kind}</TableCell>
                <TableCell className="py-1.5 text-[13px] text-muted-foreground">{[l.address.city, l.address.state].filter(Boolean).join(", ") || "—"}</TableCell>
                <TableCell className="py-1.5">
                  <Switch checked={l.is_active} onCheckedChange={(v) => active.run(l.id, v)} disabled={active.pending} aria-label="Active" />
                </TableCell>
                <TableCell className="py-1.5">
                  <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setEditing({ id: l.id, code: l.code, name: l.name, kind: (LOCATION_KINDS as readonly string[]).includes(l.kind) ? (l.kind as LocationKind) : "other", city: l.address.city ?? "", state: l.address.state ?? "" })}>
                    Edit
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Edit location" : "Add location"}</DialogTitle>
            <DialogDescription>Showrooms, offices, warehouses and sites used for scoping and walk-ins.</DialogDescription>
          </DialogHeader>
          {editing && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Code" required error={fieldError(upsert.fieldErrors, "code")}>
                <Input value={editing.code} onChange={(e) => setEditing({ ...editing, code: e.target.value.toUpperCase() })} className="font-mono" />
              </Field>
              <Field label="Kind">
                <SimpleSelect value={editing.kind} onChange={(v) => setEditing({ ...editing, kind: v as LocationKind })} options={LOCATION_KINDS.map((k) => ({ value: k, label: k }))} allowNone={false} />
              </Field>
              <Field label="Name" required className="sm:col-span-2">
                <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              </Field>
              <Field label="City">
                <Input value={editing.city} onChange={(e) => setEditing({ ...editing, city: e.target.value })} />
              </Field>
              <Field label="State">
                <Input value={editing.state} onChange={(e) => setEditing({ ...editing, state: e.target.value })} />
              </Field>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button disabled={upsert.pending || !editing?.code || !editing?.name} onClick={() => editing && upsert.run(editing)}>
              {upsert.pending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ---------------- stages ---------------- */
function StagesTab({ data }: { data: SettingsData }) {
  const [editing, setEditing] = useState<SettingsData["stages"][number] | null>(null);
  const update = useAction(updateStageAction, { onSuccess: () => setEditing(null) });
  const move = useAction(moveStageAction);
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">Custom stages map to stable reporting groups. Won / Lost / Deferred require an outcome reason; backward moves always require a reason.</p>
      <div className="overflow-x-auto rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="h-9 w-12 text-xs">#</TableHead>
              <TableHead className="h-9 text-xs">Key</TableHead>
              <TableHead className="h-9 text-xs">Label</TableHead>
              <TableHead className="h-9 text-xs">Group</TableHead>
              <TableHead className="h-9 text-xs">Reason</TableHead>
              <TableHead className="h-9 text-xs">Next action</TableHead>
              <TableHead className="h-9 text-xs">Active</TableHead>
              <TableHead className="h-9 text-xs" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.stages.map((s, i) => (
              <TableRow key={s.id}>
                <TableCell className="tnum py-1 text-[13px]">{s.position}</TableCell>
                <TableCell className="py-1 font-mono text-[12px]">{s.key}</TableCell>
                <TableCell className="py-1 text-[13px] font-medium">{s.label}</TableCell>
                <TableCell className="py-1">
                  <TonePill tone={s.reporting_group === "won" ? "success" : s.reporting_group === "lost" ? "destructive" : s.reporting_group === "deferred" ? "neutral" : "info"} label={s.reporting_group} />
                </TableCell>
                <TableCell className="py-1 text-[13px]">{s.requires_reason ? "Required" : "—"}</TableCell>
                <TableCell className="py-1 text-[13px]">{s.requires_next_action ? "Required" : "—"}</TableCell>
                <TableCell className="py-1 text-[13px]">{s.is_active ? "Yes" : "No"}</TableCell>
                <TableCell className="py-1">
                  <div className="flex items-center gap-0.5">
                    <Button size="icon" variant="ghost" className="size-6" disabled={i === 0 || move.pending} onClick={() => move.run(s.id, "up")} aria-label="Move up">
                      <ArrowUp className="size-3" />
                    </Button>
                    <Button size="icon" variant="ghost" className="size-6" disabled={i === data.stages.length - 1 || move.pending} onClick={() => move.run(s.id, "down")} aria-label="Move down">
                      <ArrowDown className="size-3" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setEditing(s)}>
                      Edit
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit stage · {editing?.key}</DialogTitle>
            <DialogDescription>Keys are stable identifiers used by reports; only labels and rules change here.</DialogDescription>
          </DialogHeader>
          {editing && (
            <div className="space-y-3">
              <Field label="Label" required>
                <Input value={editing.label} onChange={(e) => setEditing({ ...editing, label: e.target.value })} />
              </Field>
              <Field label="Reporting group">
                <SimpleSelect value={editing.reporting_group} onChange={(v) => setEditing({ ...editing, reporting_group: v })} options={["open", "won", "lost", "deferred"].map((g) => ({ value: g, label: g }))} allowNone={false} />
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={editing.requires_reason} onCheckedChange={(v) => setEditing({ ...editing, requires_reason: v })} /> Requires a reason when entering this stage
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={editing.requires_next_action} onCheckedChange={(v) => setEditing({ ...editing, requires_next_action: v })} /> Requires a next action and due date
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={editing.is_active} onCheckedChange={(v) => setEditing({ ...editing, is_active: v })} /> Active
              </label>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button disabled={update.pending || !editing} onClick={() => editing && update.run(editing.id, { label: editing.label, reporting_group: editing.reporting_group as "open", requires_reason: editing.requires_reason, requires_next_action: editing.requires_next_action, is_active: editing.is_active })}>
              {update.pending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ---------------- saved views ---------------- */
function ViewsTab({ data }: { data: SettingsData }) {
  const empty = { id: "", surface: "inbox", name: "", filters: "{}", position: "0", is_default: false };
  const [editing, setEditing] = useState<typeof empty | null>(null);
  const upsert = useAction(upsertSharedViewAction, { onSuccess: () => setEditing(null) });
  const del = useAction(deleteSharedViewAction);
  const surfaces = [...new Set(["inbox", "pipeline", "catalog", ...data.views.map((v) => v.surface)])];
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Shared saved views appear as tabs on their surface for every user. Personal views are managed on each page.</p>
        <Button size="sm" className="h-8 gap-1.5" onClick={() => setEditing(empty)}>
          <Plus className="size-3.5" aria-hidden /> Add view
        </Button>
      </div>
      {surfaces.map((surface) => {
        const rows = data.views.filter((v) => v.surface === surface);
        if (rows.length === 0) return null;
        return (
          <div key={surface} className="overflow-x-auto rounded-lg border bg-card">
            <div className="border-b px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{surface}</div>
            <Table>
              <TableBody>
                {rows.map((v) => (
                  <TableRow key={v.id}>
                    <TableCell className="tnum w-12 py-1 text-[13px] text-muted-foreground">{v.position}</TableCell>
                    <TableCell className="py-1 text-[13px] font-medium">
                      {v.name}
                      {v.is_default && <span className="ml-1 text-[11px] text-muted-foreground">(default)</span>}
                    </TableCell>
                    <TableCell className="py-1 font-mono text-[11px] text-muted-foreground">{JSON.stringify(v.filters)}</TableCell>
                    <TableCell className="w-32 py-1">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setEditing({ id: v.id, surface: v.surface, name: v.name, filters: JSON.stringify(v.filters), position: String(v.position), is_default: v.is_default })}>
                          Edit
                        </Button>
                        <Button size="sm" variant="ghost" className="h-6 px-2 text-xs text-muted-foreground" disabled={del.pending} onClick={() => del.run(v.id)}>
                          Delete
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        );
      })}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Edit view" : "Add shared view"}</DialogTitle>
            <DialogDescription>Filters are a JSON object interpreted by the surface.</DialogDescription>
          </DialogHeader>
          {editing && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Surface" required>
                <Input value={editing.surface} onChange={(e) => setEditing({ ...editing, surface: e.target.value })} className="font-mono" list="surfaces" />
                <datalist id="surfaces">
                  {surfaces.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </Field>
              <Field label="Name" required>
                <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              </Field>
              <Field label="Position">
                <Input type="number" value={editing.position} onChange={(e) => setEditing({ ...editing, position: e.target.value })} className="tnum" />
              </Field>
              <label className="flex items-center gap-2 self-end pb-2 text-sm">
                <Switch checked={editing.is_default} onCheckedChange={(v) => setEditing({ ...editing, is_default: v })} /> Default
              </label>
              <Field label="Filters (JSON)" className="sm:col-span-2">
                <Textarea value={editing.filters} onChange={(e) => setEditing({ ...editing, filters: e.target.value })} rows={3} className="font-mono text-xs" />
              </Field>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button disabled={upsert.pending || !editing?.name || !editing?.surface} onClick={() => editing && upsert.run(editing)}>
              {upsert.pending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ---------------- flags ---------------- */
function FlagsTab({ data }: { data: SettingsData }) {
  const set = useAction(setFeatureFlagAction);
  const DESCR: Record<string, string> = {
    "marketing.shoot_calendar": "Phase 2 — content opportunities and shoot calendar UI.",
    "merch.ocr_pipeline": "Phase 4 — source library, parsers, OCR review queue.",
    "stock.sql_connector": "Phase 5 — read-only SQL Account stock mirror.",
    "sales.lead_connectors": "Phase 3 — Meta / TikTok / website intake connectors.",
  };
  return (
    <div className="max-w-2xl space-y-2">
      {data.flags.map((f) => (
        <div key={f.key} className="flex items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2">
          <div>
            <div className="font-mono text-[12px]">{f.key}</div>
            <div className="text-xs text-muted-foreground">{DESCR[f.key] ?? "Workspace feature flag."}</div>
          </div>
          <Switch checked={f.enabled} onCheckedChange={(v) => set.run(f.key, v)} disabled={set.pending} aria-label={f.key} />
        </div>
      ))}
      <p className="text-[11px] text-muted-foreground">Flags gate navigation and future modules; enabling a flag does not connect any external system.</p>
    </div>
  );
}
