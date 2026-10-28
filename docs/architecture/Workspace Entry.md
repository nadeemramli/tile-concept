# Workspace entry (TILE-32)

One sign-in, one business, one dataset — presented as two **areas** of the same
workspace:

| Area | Paths | What it is |
| --- | --- | --- |
| Operating System (`operating`) | everything that existed before, `/` = Command Centre | sales, showroom, enquiries, catalogue, marketing, reports |
| Admin System (`admin`) | `/admin/**` | business administration: order preparation, deliveries |
| (neutral) | `/overview`, `/start` | above both: Management Overview and the area chooser |

The area is decided by path (`src/lib/workspace/areas.ts`), so no existing URL
moved and every bookmark still resolves.

## Authority

Entering an area is an ordinary permission in `core.role_permissions`
(`supabase/migrations/20261029000001_workspace_entry.sql`, mirrored in
`src/lib/rbac/matrix.ts`):

| Permission | Meaning |
| --- | --- |
| `workspace.operating` | enter the Operating System |
| `workspace.admin` | enter the Admin System |
| `overview.read` | land on / open the Management Overview |
| `admin.coordinate` | open the Admin System hub |
| `preparation.read` | see the preparation queue |
| `delivery.read_own` | see My Deliveries |

New roles: `business_admin` ("Admin employee" — **not** a platform
administrator: no `settings.manage`, no sales or customer access), `warehouse`,
`driver`. Every pre-existing role gains `workspace.operating`; `management`
additionally gains `workspace.admin`, `overview.read`, `admin.coordinate`,
`preparation.read` and **nothing that approves or posts** (no `stock.write`,
`purchase.correct`, `price.publish`, `review.approve`, `settings.manage`,
`marketing.spend.*` write/review). The platform `admin` gets both areas and the
admin queues but not `overview.read`, so it chooses a default instead. The demo
`guest` keeps "every permission except `settings.manage`".

Pages still check their own permission and RLS still decides every read: the
area is navigation, never a grant. A driver has no `sales.read`, so every sales
page refuses, `global_search` returns nothing and `command_centre_summary`
raises 42501 (pinned in `supabase/tests/024_workspace_entry.sql`).

## Landing rule

Applied by `/start` (the default `next` after sign-in) and by `/` for roles
without the Operating System:

1. no area → `/start` explains, no redirect (so no loop through `/`);
2. one area → straight in: Operating System → `/`; driver → `/admin/my-deliveries`;
   warehouse → `/admin/preparation`; admin employee → `/admin`;
3. both + `overview.read` (management) → `/overview`;
4. both + a remembered default that is **still permitted** → that area;
5. both, nothing remembered → the chooser at `/start`.

A deep link always wins: the proxy keeps path **and query** in `next`, and the
sign-in, magic-link and guest paths all honour it (falling back to `/start`).
An unauthorised deep link still opens and is refused on the page.

## Remembered default

`core.user_preferences(user_id, workspace_id, default_area)`; RLS lets a member
read only their own row, there are no write policies, and the only writer is
`api.set_default_area(p_area text default null)` (SECURITY DEFINER), which
refuses an area the caller lacks (42501) and unknown values (22023). The app
also ignores a stored area once its permission is gone. Read in parallel inside
`getSession()` — no extra round trip.

## Shell

- The sidebar lists **one area at a time** (`sidebarRoutes(perms, area)`); Admin
  routes carry `area: "admin"` and never lengthen the Operating System list.
- `WorkspaceSwitcher` sits in the top bar (in the phone menu for roles whose
  header is busy) and offers only permitted areas; dual-area members without
  the overview set or clear their start page there. Switching is client
  navigation in the same session.
- Search and the attention bell only show for roles with sales/catalogue data.

## Language

Bahasa Melayu by default, English one tap away (`tc.locale` cookie, so it
applies before sign-in too). `<html lang>` stays `en` because most screens are
still English; each translated surface declares its own `lang` (`Localized`,
the switcher, the Admin area sidebar) so screen readers pronounce it correctly. Translated: sign-in,
switcher, chooser, overview, Admin System pages and denials
(`src/lib/i18n/messages.ts`; a unit test fails if a key is missing in either
language). **Existing Operating System screens remain English** — translating
them is separate work.

## Not built here (honest placeholders)

Preparation queue, delivery schedule and My Deliveries show "Belum dibina /
Not built yet" with no numbers. No scheduling, delivery records, stock posting
or accounting were added.
