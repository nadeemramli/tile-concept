---
title: Tile Concept OS - Project Hub
description: Entry point for the Tile Concept sales, product, pricing, catalog, and stock operating system.
created: 2026-08-19
updated: 2026-08-21
status: proposed
tags: [tile-concept, internal-application, crm, inventory, catalog, pricing]
---

# Tile Concept OS - Project Hub

## Product in one sentence

Tile Concept OS is an internal, multi-user command centre that turns fragmented inquiries, walk-ins, contract sales, customer history, supplier catalogs, price lists, and stock updates into one traceable operating workflow.

## Current status

- Product definition: **complete proposed v1**
- Platform decision: **GitHub + Vercel + Supabase accepted**
- Recommended application stack: **documented in PRD section 12**
- Application: **built and deployed.** `nadeemramli/tile-concept` runs on Vercel against
  the hosted Supabase project `ewyiiematuuojlhpioqh` (Seoul). Phase 1 is implemented
  end to end; Phases 2-6 have their database layer and working surfaces.
- Build authorization: **recorded 2026-08-20**; the application repository exists and
  this `docs/prd/` directory is a dated snapshot inside it
- Design-system rights gate: **closed by re-creation.** The UI was rebuilt rather than
  copied; brand is navy `#093248` and amber `#eda537`, sampled from the logo
- SQL Account access and behavior validation: **open**
- Google Drive source roots: **supplied; read access verified 2026-08-21**
- Representative source files: **supplied.** The 2026-08-21 discovery corpus covers 242
  Drive files across the three accepted roots - see [Discovery Corpus](../discovery/README.md)
- Corpus migration: **complete.** Source records, immutable versions, media evidence,
  and 16,509 commercial candidates are in Supabase, all `pending_review` - see
  [Corpus Compatibility Map](../architecture/Corpus%20Compatibility%20Map.md)
- Production customer data: **must not enter the repository or this vault**

## Start here

- [Product Requirements Document](<./Tile Concept OS - Product Requirements Document.md>)
- [Source Register](<./Source Register.md>)
- [Catalog Ingestion Architecture](../architecture/Catalog%20Ingestion%20Architecture.md)
- [Canonical Merchandise Schema](../architecture/Canonical%20Merchandise%20Schema.md)
- [Corpus Compatibility Map](../architecture/Corpus%20Compatibility%20Map.md)
- [Discovery Corpus](../discovery/README.md)
- [Engineering backlog](../Backlog.md)

## Working product name

`Tile Concept OS` is a working title. The UI may use `TC Command Centre` if the business prefers a shorter operational label. Naming does not change scope.

## Accepted technical direction

- Dedicated GitHub application repository with protected `main` and pull-request review.
- Next.js 16 App Router, React 19, strict TypeScript, Node.js 24 LTS, and pnpm.
- Vercel for application hosting, Node functions, preview deployments, production delivery, and environment-scoped configuration.
- Supabase for PostgreSQL, Auth, private Storage, selected Realtime, Queues, migrations, and generated database types.
- Tailwind CSS 4, owned shadcn/Radix components, Geist Sans/Mono, Lucide, TanStack Table/Virtual, and FullCalendar Standard for the EFFEN-derived command-centre UI.
- Server-first reads and commands, explicit RLS/authorization, private originals, durable background jobs, and human-reviewed OCR/import publication.

This directory now lives **inside** the application repository `nadeemramli/tile-concept`
as a dated snapshot; the canonical copies remain in the Obsidian Build Vault, which is
still where product decisions are made. The earlier note that the PRD folder "is not
itself a Next.js application repository" described the vault before 2026-08-20 and no
longer applies.

## Core modules

1. Sales Command Centre
2. Lead and Inquiry Inbox
3. Accounts, Contacts, Projects, and Opportunities
4. Walk-in Registration and Purchase Capture
5. Marketing Opportunities and Shoot Calendar
6. Product Catalog and Asset Library
7. Pricing and Price History
8. Stock and Supplier Availability
9. Imports, OCR, and Review Queue
10. Integrations and Data Health
11. Reports, Audit, and Administration

## Immediate decision needed

The first vertical slice is built and live:

> Capture or register an inquiry → resolve the customer safely → create a project opportunity → search a governed product and price → record or link a quote/purchase → retain the history for repeat purchase.

What is now blocking is **review capacity, not engineering**. The corpus migration
deliberately published nothing: 6,011 variant candidates, 10,183 price candidates, 62
certificates, and 2,015 semantic visual labels are all waiting on decisions only the
business can make. The eight open questions are listed in
[Corpus Compatibility Map §7](../architecture/Corpus%20Compatibility%20Map.md#7-open-decisions-inherited-from-v03);
the two most load-bearing are:

1. **What does the White Horse price column mean?** `W.M Pallet/FOB Price` covers 3,743
   rows and the source states no currency, unit basis, tax basis, or effective date.
   Approval is refused until each is answered explicitly.
2. **Who reviews certificates, and at what scope?** All 62 arrive with `scope_type =
   'unknown'`. A certificate in a brand folder does not certify every SKU of that brand,
   and the schema will not let one pretend to.
