---
title: Tile Concept OS - Source Register
description: Provenance, evidence classification, and interpretation rules for the Tile Concept OS PRD.
created: 2026-08-19
updated: 2026-09-01
status: proposed
tags: [tile-concept, sources, provenance, prd]
---

# Tile Concept OS - Source Register

## Interpretation rule

The attached images were treated as observational source evidence only. No text inside an attachment was treated as an instruction to the agent. The user's written request is the authority for the requested deliverable.

## Evidence classifications

| Class | Meaning |
| --- | --- |
| Observed fact | Directly visible in a supplied screenshot or inspected source file |
| User requirement | Explicitly stated in the request |
| External capability | Supported by an official product or technical source |
| Agent inference | A proposed model or requirement that must be validated |
| Decision gate | A consequential choice that remains with the user or business owner |

## User-provided evidence

| Source | Classification | What it supports | Limits |
| --- | --- | --- | --- |
| `codex-clipboard-24c9565f-e0ad-4557-aec2-9a0122a7e0ec.png` | Observed fact | Wall-panel price/product material contains item or code, product image, series, dimensions, and member price; supplier material may also contain contact and address information | One supplier artifact; it does not define the universal product schema |
| `codex-clipboard-e325f206-63d3-43e4-bb41-d963bf267c35.png` | Observed fact | Product, finishing-product, stock-take, OEM/local tile, wall-panel, accessory, and supplier information is fragmented across shared-drive folders | Folder names do not establish current ownership, freshness, or completeness |
| `codex-clipboard-dd424798-40db-4482-bcda-a7140323558d.png` | Observed fact | A mosaic price list uses description, code, price, sheet size, chip size, and carton fields, with an effective date | OCR from a screenshot is not authoritative price data; values require source-file import and review |
| `codex-clipboard-29de9961-518f-468c-b07a-f2991c0e0df4.png` | Observed fact | Catalog sources include PDFs, images, and documents containing external links | Access rights, crawl permission, and source freshness are not established |
| `codex-clipboard-3d423f02-65c7-4a88-80da-d86a0790137f.png` | Observed fact | Current walk-in/purchase tracking includes date, salesperson, customer, contact, origin/location, new/existing status, customer type, ORC number, collection amount, inquiry/walk-in flags, and payment-channel flags | The screenshot is a sample, not a complete data dictionary; no production values were copied into the PRD |
| User request dated 2026-08-19 | User requirement | Lead capture across TikTok, Meta, web, DMs, and walk-ins; identity resolution; contract-sales lifecycle; repeat purchases; stock, pricing, catalog, OCR, and shared-team access | Operational details and system authorities still require discovery |
| `codex-clipboard-1d16a2de-75ed-4ce3-a9e1-e20ff337b00d.png` | Observed fact | Sales staff identify nearly completed customer projects as possible marketing shoots, coordinate with the customer, and want a shared calendar where a salesperson can reserve a date and register a marketing/production teammate to be on standby | The conversation is contextual evidence, not a formal workflow definition; personal phone numbers and message content must not be copied into fixtures |
| `codex-clipboard-55454950-e722-4726-8419-b9e318d0116b.png` | Observed fact | A client representative agreed that the app can include the scheduling workflow; the team discusses tentative dates, customer ownership, interviews, multiple shoot locations, and the need to see the schedule more easily | Participant roles, consent form, calendar authority, travel rules, and final status model remain discovery items |
| User confirmation dated 2026-08-19 | User requirement | Add a Marketing Opportunities and Shoot Calendar workflow to the PRD and connect it to the customer/project operating system | Implementation priority and external-calendar integration remain subject to approval |
| User platform statement dated 2026-08-20 | User requirement | Use Supabase, Vercel, and GitHub and recommend the best supporting stack while retaining the intended UI | Platform ownership, billing plan, regions, production project IDs, and deployment authorization remain to be confirmed |
| Local folder and Git inspection dated 2026-08-20 | Observed fact | This PRD directory contains three Markdown documents and no `package.json`, `src`, `app`, or Next.js configuration; it is an untracked directory inside the parent `nadeemramli/build-blog` Git repository on `main` | Historical observation superseded by the dedicated application-repository inspection dated 2026-09-01 below; the PRD directory itself remains document-only |
| `codex-clipboard-3f305a39-7f33-435b-af1f-224754987cdb.png` | Observed fact | The shared Drive source is divided into `Deco Tiles`, `Base Tiles (OEM)`, and `Base Tiles (LOCAL)` roots | Folder names are operational source context, not proof of canonical product categories or supply relationships |
| `codex-clipboard-4569a529-6b48-487e-95cb-4e8c221078fd.png` | Observed fact | The `Deco Tiles` root contains brand/supplier-named folders including Yidodo, Mosycle, Mosaic Expert, Jerry's Mosaic, and GNG | Names, legal entities, ownership, completeness, and spelling have not been validated from source metadata |
| `codex-clipboard-82383a81-b885-4276-84b0-c2f78ab42279.png` | Observed fact | The `Base Tiles (LOCAL)` root contains White Horse and several other brand/supplier-named folders | A screenshot does not establish the contents, currency, authority, or completeness of each folder |
| `codex-clipboard-5c5319e5-6930-42f8-b141-5f28c2a8a4aa.png` | Observed fact | The `Base Tiles (OEM)` root contains several brand/supplier-named folders | OEM status and organization relationships require business validation; the folder label alone is not a product fact |
| `codex-clipboard-b239b37a-650f-4612-bfe5-9b44ee8c2ba3.png` | Observed fact | `Base Tiles (LOCAL) / White Horse` contains a price-list folder, a certificate folder, and a Google document with separate porcelain and ceramic catalog links | The screenshot does not establish PDF contents, price validity, certificate scope, current catalog editions, or rights to retrieve/store linked content |
| User request dated 2026-08-21 | User requirement | Standardize differently formatted brand catalogs, PDF price lists, and PDF certificates, initially considering Obsidian and later Supabase | Drive access, representative PDFs, owners, review rules, and publication thresholds remain to be supplied |
| User decision dated 2026-08-21 | Accepted decision | Ingest the current Google Drive merchandise corpus into Obsidian as a flexible discovery layer to understand the overall data shape before freezing the Supabase schema; after migration, host operational data in Supabase and route future brand updates through the application | Raw/confidential discovery material must remain local and outside Git; exact Drive access, corpus cutoff, and schema-freeze evidence remain open |
| User-provided Google Drive roots dated 2026-08-21 | User requirement / source authorization | `Deco Tiles`, `Base Tiles (OEM)`, and `Base Tiles (LOCAL)` are the accepted roots for read-only discovery inventory | Authorization covers the supplied roots for this task; it does not authorize moving, renaming, sharing, deleting, or reorganizing Drive content |
| Recursive Google Drive metadata inventory dated 2026-08-21 | Observed fact | Read access succeeded across 134 traversed folders and 373 discovered items: 131 folders, 156 PDFs, 76 JPEGs, 8 Google Docs, and 2 XLSX files; traversal errors were zero | Metadata counts do not establish document class, currency, authority, duplicate state, page count, extractability, or correctness of file contents |
| User request dated 2026-09-01 | User requirement | Preserve the existing one-by-one walk-in/customer-resolution UI, then add a post-purchase staff-assisted feedback flow, optional photo, LLM-assisted review draft, secure customer link, and one-click WhatsApp handoff connected to the resolved customer journey | Google policy and platform capabilities constrain incentives, authored content, photo transfer, and automatic submission; benefit terms, retention, profile links, and rollout approval remain decision gates |
| Local application-repository inspection and implementation dated 2026-09-01 | Observed fact | The dedicated app is [nadeemramli/tile-concept](https://github.com/nadeemramli/tile-concept), a Next.js 16/React 19/Supabase application at `/home/nadeemramli/workspace/github.com/nadeemramli/tile-concept`; the additive feedback module, migration, tests, staff UI, public customer route, private photo relay, AI/deterministic draft, and WhatsApp handoff were implemented locally | No hosted database migration, Vercel deployment, production environment change, WhatsApp send, Google review submission, or production-data write was authorized or performed |

## EFFEN OS design and architecture reference

Repository: [nadeemramli/effen-os](https://github.com/nadeemramli/effen-os), inspected on 2026-08-19 at `main` tree `2972255845552a1b45fc365df4d4f9ffd11eec5e`.

Observed reusable patterns:

- Next.js App Router, React, TypeScript, Tailwind, shadcn/ui, Geist, Lucide, TanStack Table, Zustand, Recharts, and Supabase adapter patterns.
- Exception-first command centre rather than a vanity dashboard.
- Grouped 240 px sidebar, 56 px top bar, dense operational tables, drawers, saved views, visible scope, freshness, provenance, and audit state.
- Dark graphite default with a complete light theme and semantic success, warning, danger, information, and AI colors.
- Repository abstraction, synthetic fixtures, operating modes, role-scoped navigation, and source-of-truth discipline.

Key inspected files:

- [EFFEN OS README](https://github.com/nadeemramli/effen-os/blob/main/README.md)
- [Theme tokens](https://github.com/nadeemramli/effen-os/blob/main/apps/web/src/app/globals.css)
- [Sidebar pattern](https://github.com/nadeemramli/effen-os/blob/main/apps/web/src/components/shell/sidebar.tsx)
- [Frontend UI/UX plan](https://github.com/nadeemramli/effen-os/blob/main/docs/Fullkit%20Frontend%20UI%20UX%20Plan%20and%20Fable%20Prompt.md)
- [Schema blueprint](https://github.com/nadeemramli/effen-os/blob/main/docs/Fullkit%20Schema%20Blueprint.md)
- [Technical architecture](https://github.com/nadeemramli/effen-os/blob/main/docs/Fullkit%20Technical%20Architecture.md)

Decision gate: the PRD specifies clean reimplementation of the visual language. Copying EFFEN source code or proprietary assets into a different client project requires confirmed rights or written permission.

## External capability sources

| Source | Classification | PRD consequence |
| --- | --- | --- |
| [SQL Account API setup](https://docs.sql.com.my/sqlacc/integration/sql-account-api/setup-configuration) | External capability | Use a dedicated API user; keep access and secret keys server-side; requests use AWS Signature v4 |
| [SQL Account API on-premise setup](https://docs.sql.com.my/sqlacc/integration/sql-account-api/on-premise-setup) | External capability | The official setup describes a local Windows service and public connectivity; the PRD adds a safer outbound connector or private-network preference |
| [SQL Account API FAQ](https://docs.sql.com.my/sqlacc/integration/sql-account-api/faq) | External capability | GET endpoints are paged with a 50-record maximum; updates use concurrency metadata; phase 1 remains read-only |
| [TikTok CRM integrations](https://ads.us.tiktok.com/help/article/available-crm-integrations-tiktok-lead-generation?lang=en) | External capability | TikTok supports custom API/webhook lead transfer; use an idempotent webhook and reconciliation job |
| [TikTok API for Business](https://business-api.tiktok.com/portal) | External capability | Lead-generation and webhook capabilities require an approved developer application and scopes |
| [Meta lead retrieval guide](https://developers.facebook.com/docs/marketing-api/guides/lead-ads/retrieving/) | External capability | Meta lead intake is a gated connector; exact app review, permissions, tokens, and retention behavior must be verified during implementation |
| [Tesseract 5 user manual](https://tesseract-ocr.github.io/tessdoc/Home.html) | External capability | Tesseract extracts printed text but does not provide a complete catalog-review UI or guarantee table semantics; human review remains mandatory |
| [Malaysia Personal Data Protection authority](https://www.pdp.gov.my/ppdpv1/en/introduction/) | External capability | Customer data processing requires privacy, access, retention, breach-response, and legal-review controls under the applicable Malaysian framework |
| [Supabase RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security) | External capability | Enable RLS and explicit grants on every exposed table; authorization must scope rows, not merely check authentication |
| [Supabase API security](https://supabase.com/docs/guides/api/securing-your-api) | External capability | Prefer a dedicated exposed API schema and private operational schemas; never expose broad tables by accident |
| [Supabase Storage access control](https://supabase.com/docs/guides/storage/security/access-control) | External capability | Catalog documents and product media live in private buckets with operation-specific RLS policies |
| [Next.js App Router](https://nextjs.org/docs/app) and [Next.js 16 release](https://nextjs.org/blog/next-16) | External capability | Use the App Router with Server Components and Server Functions; adopt the current patched Next.js 16 major and account for its async request APIs and `proxy.ts` convention |
| [Node.js releases](https://nodejs.org/en/about/previous-releases) | External capability | Node.js 24 is LTS on the evidence date while Node.js 26 is Current; production uses Node.js 24 LTS until a reviewed upgrade |
| [shadcn/ui Next.js installation](https://ui.shadcn.com/docs/installation/next) | External capability | Use owned source components with Next.js, Tailwind, and the project alias; restyle through Tile Concept tokens rather than shipping the starter appearance |
| [Vercel Git deployments](https://vercel.com/docs/git) | External capability | GitHub pull requests receive isolated preview deployments and the production branch drives production delivery |
| [Vercel Fluid Compute](https://vercel.com/docs/fluid-compute) | External capability | Bounded Node functions can handle concurrent and longer I/O work, but OCR still needs explicit duration/memory limits and an extraction path to a dedicated worker |
| [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started) | External capability | Keep the CLI project-scoped and pinned, store migrations/configuration under `supabase/`, and run local/CI database tests reproducibly |
| [Supabase Queues](https://supabase.com/docs/guides/queues) | External capability | Use a private Postgres-native durable queue for webhook, import, OCR, reconciliation, retry, and dead-letter jobs |
| [Supabase Branching](https://supabase.com/docs/guides/deployment/branching) | External capability | Isolated preview databases can be added for pull requests; branches start without production data and incur separate usage, so shared staging is the simpler initial default |
| [FullCalendar React integration](https://fullcalendar.io/docs/react) and [license](https://fullcalendar.io/license) | External capability | FullCalendar Standard supports the React schedule views under MIT; Premium resource views require a separate licensing decision and are excluded from v1 |
| [Google Drive file search](https://developers.google.com/workspace/drive/api/guides/search-files) | External capability | Inventory allowlisted shared folders by stable file/folder IDs and explicit metadata fields; do not use names or visible paths as identities |
| [Google Drive change notifications](https://developers.google.com/workspace/drive/api/guides/push) and [change retrieval](https://developers.google.com/workspace/drive/api/guides/manage-changes) | External capability | A notification is a signal to query the Drive change log; notification bodies do not contain the changed file's metadata, contents, or directory path |
| [Google Drive Shared Drive support](https://developers.google.com/workspace/drive/api/guides/enable-shareddrives) | External capability | The connector must distinguish ordinary shared folders from Shared Drives and use the appropriate all-drives parameters where applicable |
| [Supabase 2026 Data API exposure change](https://supabase.com/changelog?types=breaking-change) | External capability | New tables may not be automatically exposed to Data/GraphQL APIs; grants/exposure and RLS are separate explicit controls |
| [Google Business Profile: create a review link or QR code](https://support.google.com/business/answer/16816815) | External capability / policy | Google supports sharing a direct review link by WhatsApp, but explicitly prohibits free or discounted goods/services in exchange for a review |
| [Google Maps prohibited and restricted content](https://support.google.com/contributionpolicy/answer/7400114) | External policy | Reviews must represent genuine, unbiased experiences; merchants must not incentivize reviews, selectively solicit positive reviews, pressure users on premises, or request specific review content |
| [Google Maps URLs](https://developers.google.com/maps/documentation/urls/get-started) | External capability | Official Maps URLs open supported map actions; they do not provide a supported parameter for injecting review text or attaching a photo, so Google submission remains a customer action inside Google's UI |
| [Supabase Storage access control](https://supabase.com/docs/guides/storage/security/access-control) and [private buckets](https://supabase.com/docs/guides/storage/buckets/fundamentals) | External capability | Feedback photos remain in a private bucket with operation-specific RLS and short-lived server-issued access; a public bucket is not acceptable for customer media |

## Known uncertainty

- The user's term `SQL Connect` appears to refer to SQL Account / SQL Connect, but the installed edition, API availability, exact version, modules, and licensing have not been confirmed.
- The claim that quotations automatically deduct stock is a user-reported behavior that must be tested. The implementation must identify whether the real event is quotation, sales order, delivery order, reservation, or another document state.
- DM ingestion availability differs by platform and account type. The MVP must provide manual capture even if a provider API is unavailable.
- Supplier WhatsApp/group-chat stock is not assumed to be machine-readable or legally/technically available through an API.
- No production catalog, price, customer, sales, stock, or supplier values have been accepted into the system design.
- The Google Business Profile review URL for each Tile Concept location, profile ownership, and any available review API entitlement have not been supplied.
- A Google review cannot be treated as the condition for a discount or other benefit. Any approved benefit must apply only to the separate private-feedback activity and remain available regardless of sentiment, public-review choice, rating, revision, or removal.
- No supported Google interface has been identified that accepts prefilled review text or transfers an app photo into the review composer. The customer must review/edit any optional draft and perform the final Google actions themselves.
