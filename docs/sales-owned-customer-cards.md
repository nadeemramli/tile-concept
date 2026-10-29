# Sales-owned customer cards (TILE-11)

Migration `supabase/migrations/20261029164000_sales_owned_customer_cards.sql`. Tests: `supabase/tests/024_sales_owned_customer_cards.sql` (pgTAP), `tests/e2e/customer-cards.spec.ts` (browser against a running app and the local stack), `tests/unit/customer-card-schema.test.ts`.

## The PIC

A customer card is a contact (person) or an account (company). Each card has one **PIC**: the salesperson who owns it.

| Column | Meaning |
| --- | --- |
| `owner_id` | The card's PIC. Added to `identity.contacts`; already existed on `identity.accounts`. |
| `created_by` | Who first saved the card. Set by the database on direct inserts; a submitted value is ignored. |
| `updated_by` | Who last changed it. |
| `owner_assigned_by` / `owner_assigned_at` | Who made the current PIC assignment, and when. This is the creator for a new card, or the person who transferred it. |

Enquiries keep their own owner (`sales.leads.owner_id`, set through `api.assign_lead`). The two are not synchronised. `api.customer_card_pic_exceptions` lists every open enquiry whose owner differs from the PIC of its linked card. "Customer/company PIC" on projects (`identity.projects.follow_up_contact_id`) means the customer's own contact person and has nothing to do with this.

## Rules

1. **Create under yourself only.** `api.create_contact` and direct inserts into `api.contacts` and `api.accounts` make the caller the PIC. If the request names anyone else, the whole request fails with `42501 You can only create or edit customer cards assigned to your own account.` and nothing is written. Server actions pass a submitted `owner_id` through to the database, so a forged value is refused rather than silently dropped.
2. **Only the PIC edits.** Through any `api` view or PostgREST request, only the PIC can update a card's fields, archive it, delete it, change its PIC, or add, change or remove its contact points, aliases or company relationships. A company relationship counts as part of the person's card. Every role is held to this, including `sales_manager`, `admin` and the demo `guest`. `sales.read_all` no longer overrides it for customer cards.
3. **Transfer is explicit and audited.** `api.transfer_customer_card(card, id, new_owner, reason)` needs `sales.assign` and a reason. The new PIC must be an active member of the workspace with `sales.write`. Each transfer writes one `customer_card.pic_transferred` audit event recording the actor, old PIC, new PIC, reason and time. In the UI it is the **Transfer PIC** button on contact and account pages.
4. **Reading is unchanged.** Anyone with `sales.read` in the workspace sees every card (phone and email stay masked until revealed). Cards in other workspaces stay invisible and cannot be written.
5. **Enquiries can't write onto someone else's card.** `api.link_lead_contact` and `api.convert_lead` keep their existing lead-owner rules. If a link would copy the enquiry's phone or email onto a contact, the caller must be that contact's PIC. A link that adds nothing to the card still works for a shared editor.

In the UI, non-PICs see **Edit**, **Alias**, **Add phone/email** and **Link account** disabled, with a hint naming the PIC. Logging activity, adding tasks, opening opportunities and recording walk-ins stay open to the team.

## Write paths covered

| Path | How it is held |
| --- | --- |
| Direct writes to `api.contacts`, `api.accounts`, `api.contact_points`, `api.account_aliases`, `api.account_contact_relationships` (app server actions and raw PostgREST) | `enforce_customer_card_pic` triggers. These use invoker rights and apply when `current_user = 'authenticated'`. |
| `api.create_contact` (contact form, inbox, walk-in wizard, walk-in import, `scripts/import/daily-tracker.mts`) | The caller becomes PIC. A forged `p_owner_id` is refused. |
| `sales.attach_lead_identity` (`api.link_lead_contact`, `api.convert_lead`) | PIC check before any contact point is copied. Runs in the same transaction, so a refused conversion leaves no project or opportunity behind. |
| `api.transfer_customer_card` | Rule 3. |

These SECURITY DEFINER paths still write card rows and were left unchanged on purpose:

- **Merges.** `api.merge_contacts` and `api.unmerge_contacts` need `identity.merge` and an audited reason. They come from the identity-review decision, not from sales editing.
- **Derived facts.** `lifecycle_state` and `original_acquisition_source`/`_at` are updated by `record_purchase`, `record_walk_in`, `record_showroom_visit`, `sale_command` and lead attachment. They are facts derived from visits, sales and enquiries, not card edits.
- **Consent records.** `api.consent_records` stores what the customer said. It stays open to sales staff and is not treated as a card field.
- **Service-role scripts.** Server-side scripts run as `service_role`, not as a member. They are trusted tooling, not a sales path.

## Conflicts with accepted shared-edit behaviour

`docs/shared-sales-policy-tests-handoff.md` records the deployed rule that `sales_rep` holds `sales.read_all` together with `sales.write`, and that this pair overrides owner checks. For customer cards, this change replaces that rule. Observed effects on a fresh local stack (log of the first run, before any fixture changes: 2 files failed):

| Existing behaviour | Now | Test change |
| --- | --- | --- |
| A rep links or converts an enquiry onto any contact and its phone is copied (`006_lead_identity` 7-10) | Refused unless the rep is the contact's PIC | The fixture makes rep 1 the PIC of the contact used. Assertions unchanged. |
| A rep ends or re-links company relationships of contacts nobody owns (`021_company_search_project_registration` lines 45-47) | Refused: those contacts have no PIC | Fixture contacts get rep 1 as PIC. Assertions unchanged. |
| Shared enquiry, opportunity, task and follow-up editing (`018_shared_sales_policy`) | Unchanged. Those are not customer cards. | None. All 51 assertions still pass. |
| Managers and admins edit any account or contact, including its owner, through the edit form | Refused unless they are the PIC. They transfer first, which is audited. | New coverage in `024`. |
| The account form let anyone pick an owner | The form shows the PIC read-only. Changes go through Transfer PIC. | Covered by E2E. |

## Unresolved policy (not implemented, recorded as blockers)

- **Admin and manager direct edits.** Today an admin or sales manager must transfer a card to themselves (audited) before editing it. Whether either role should edit another PIC's card in place, and with what audit, is undecided. No override was added.
- **Marketing assignment.** `marketing_coordinator` can read cards but has neither `sales.write` nor `sales.assign`, so it cannot create, edit or transfer them. Whether Marketing may hand a card or enquiry to Sales, and through which permission, is undecided. No permission was granted. The `024` test pins the current refusal.
- **Linking to another PIC's company.** A contact's PIC may link that contact to any company card. Whether the company's PIC must also agree is undecided.
- **The PIC handing over their own card.** Only `sales.assign` holders transfer. Whether a PIC may hand a card to a colleague without a manager is undecided.
- **Merging two cards with different PICs.** The surviving contact keeps its own PIC. A rule for choosing between PICs is undecided.

## Legacy exceptions before cutover

No backfill runs. Every contact saved before this migration has `owner_id = null`, as does every account nobody chose an owner for. These cards are readable but nobody can edit them until a `sales.assign` holder assigns a PIC with `api.transfer_customer_card`. Before cutover:

```sql
select card, exception, count(*) from api.customer_card_pic_exceptions group by 1, 2;
```

- `missing_pic`: assign a PIC. `lead_owner_ids` and `created_by` are shown as evidence and are never applied automatically.
- `lead_owner_differs`: reassign the enquiry (`api.assign_lead`) or transfer the card.

Demo workspace guests are new anonymous users, so the seeded demo cards are read-only to them. A guest holds `sales.assign` and can transfer a card to themselves to try editing it.

## Migration order

`20261029164000_sales_owned_customer_cards.sql` comes after `20261016015608_catalog_upload_storage_read_access.sql` and has no dependency on unmerged branches. It drops and recreates `api.create_contact` with an extra trailing `p_owner_id` parameter. Existing callers keep working because the parameter has a default. Regenerate `src/lib/supabase/database.types.ts` after applying it.
