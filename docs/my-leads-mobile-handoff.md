# My Leads on a phone — TILE-56 handoff

A focused, phone-first list of a salesperson's own inquiries at `/sales/my-leads` (**Prospek Saya**), with one clear next action per lead and quick follow-up updates. Bahasa Melayu by default, English from the language toggle. Local implementation evidence only: no hosted migration, data change or deployment, and no customer was messaged.

## What it is

- **Same population, same rules.** The list is `api.inquiry_page` with `owner = mine`; tabs are existing inbox views (Susulan hari ini → `follow-ups-due`, Perlu tindakan → `needs-action`, Akan datang → `upcoming`, Semua → `all`), so counts agree with the Inquiry Inbox. The detail reads `api.inbox_leads` and `api.entity_timeline` like the inbox drawer. Updates go through the existing `api.work_inquiry` and `api.annotate_inquiry` commands, with the inbox's request-ID retry rule (a double tap or an uncertain network result records once). **No schema change.**
- **One next action.** Never contacted (status `new`, nothing recorded) → *WhatsApp dihantar*; an open follow-up → *Susulan selesai*; otherwise → *Jadualkan susulan*. Closed inquiries (lost, duplicate, closed sale) offer only a remark. Other updates: customer replied, no response, call/email, reschedule, no next action needed, remark. Loss, reopening, reassignment, classification, quotations and forecasts stay in the Inquiry Inbox and other modules.
- **Masking and contact.** Lists always show the masked number and never carry the raw one. The detail sends the raw number to the browser only for a role with `contact.reveal` (the inbox drawer's rule); others see the mask and which roles can see it. *Telefon* / *Buka WhatsApp* open the salesperson's own apps with no prefilled text; nothing is sent or recorded by opening them. Recording *WhatsApp dihantar* stays a separate, deliberate step.
- **Who can do what.** The page needs `sales.read`; a role without it gets the localized denial. Updates need `sales.write` and ownership (`sales.read_all`, unowned or own lead), exactly what `work_inquiry` enforces; otherwise every control renders disabled with the reason. A deep link to a lead the role cannot read (another rep's lead for a role without lead read-all, another workspace) shows "not found", never the record.
- **Navigation.** A top-bar shortcut (phone icon, labelled in the interface language) for members with `sales.write`. The sidebar is unchanged.
- **States.** Route-level loading skeleton, a localized error boundary with Retry, per-tab empty states, a search empty state with Clear search, a not-found state, inline validation, and the database's refusal text on a failed save.

## Files

- `src/app/(app)/sales/my-leads/{page,loading,error}.tsx`
- `src/features/my-leads/` — `lib/my-leads.ts` (next action, tabs, KL due-day, contact links), `components/my-leads-view.tsx` (list, tabs, search, pager, detail), `components/quick-actions.tsx` (action sheet), `types.ts`, tests
- `src/server/queries/my-leads.ts` — narrows inbox rows to what a phone needs; reveal rule
- `src/lib/i18n/messages.ts` (`myLeads`, `denied.reasons["sales.read"]`), `src/lib/nav/routes.ts` (`my-leads`), `src/components/shell/top-bar.tsx` (localized chrome labels), `src/server/commands/inquiry.ts` (revalidates `/sales/my-leads`)
- `tests/e2e/my-leads.spec.ts`, `tests/unit/my-leads-nav.test.ts`, `tests/e2e/route-smoke.ts` (error-boundary heading)

## Verify locally (isolated, synthetic)

Node 24, pnpm 11, Docker. Uses the repository's own local stack (ports 56321–56324); never a hosted project.

```bash
pnpm install --frozen-lockfile
pnpm db:start
pnpm typecheck && pnpm lint && pnpm test
pnpm exec supabase test db
pnpm build && pnpm exec next start -p 3000
E2E_BASE_URL=http://localhost:3000 pnpm exec playwright test tests/e2e/my-leads.spec.ts
pnpm db:stop
```

`.env.local` must point at the local stack (`pnpm exec supabase status -o env` prints the local keys). The spec creates its own users (rep, teammate, showroom, marketing coordinator, driver), its own leads and a second workspace with a random run id, refuses non-local API URLs, never follows a call/WhatsApp link, never signs anyone out, and deletes everything it created (it skips the immutable-remark guard only for its own rows). Parallel workers do not share fixtures.

## Staff QC (test deployment, synthetic customers)

1. On a phone, open **Prospek Saya** from the top bar. Check BM labels, the four tabs and counts against the Inquiry Inbox with Owner = Mine.
2. Open a new lead: the next action is *WhatsApp dihantar*. Tap *Buka WhatsApp* only for a test number; nothing is sent until you press send in WhatsApp. Then record it, schedule a follow-up with *Esok*, complete it with an outcome, add a remark. Reload after each step; check the same lead in the desktop Inquiry Inbox.
3. Repeat as a showroom user (masked number, no call links) and as a marketing coordinator (read-only for unassigned leads, another rep's lead not found).
4. Switch to EN from the toggle and back.

## Not covered

Live (Realtime) refresh is not wired into My Leads; it refreshes after each update, on navigation and on reload. The activity excerpt shows the latest 10 events; full history stays in the Inquiry Inbox. Production-scale latency and the hosted deployment were not measured.
