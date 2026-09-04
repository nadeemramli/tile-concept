---
title: Tile Concept OS - Project Hub
description: Entry point for the Tile Concept sales, product, pricing, catalog, and stock operating system.
created: 2026-08-19
updated: 2026-09-01
status: active
tags: [tile-concept, internal-application, crm, inventory, catalog, pricing]
---

# Tile Concept OS - Project Hub

## Product in one sentence

Tile Concept OS is an internal, multi-user command centre that turns fragmented inquiries, walk-ins, contract sales, customer history, supplier catalogs, price lists, and stock updates into one traceable operating workflow.

## Current status

- Product definition: **complete proposed v1**
- Platform decision: **GitHub + Vercel + Supabase accepted**
- Recommended application stack: **documented in PRD section 12**
- Application repository: **[nadeemramli/tile-concept](https://github.com/nadeemramli/tile-concept), located and inspected on 2026-09-01**
- Build authorization: **customer-feedback/review feature requested on 2026-09-01 and implemented locally in the dedicated application repository; hosted rollout is not yet authorized or applied**
- Design-system rights gate: **open**
- SQL Account access and behavior validation: **open**
- Google Drive source roots: **supplied and read access verified on 2026-08-21**
- Recursive metadata inventory: **complete; 373 items across 134 traversed folders with zero traversal errors**
- Current Drive corpus extraction: **242 file profiles complete; 239 readable content sources; one credentials record excluded; two oversized catalogs intentionally deferred**
- Provisional merchandise extraction: **35 shape clusters; 6,011 variant candidates; 10,183 price candidates; 62 certificate candidates; all remain unreviewed**
- Visual corpus extraction: **154 source PDFs and 76 standalone images staged; 2,022 relevant pages rendered; 2,098 pixel observations; 3,344 provisional media-to-variant links; semantic labels await human approval**
- Production customer data: **must not enter the repository or this vault**
- Catalog discovery direction: **Obsidian-first soft-schema ingestion accepted on 2026-08-21; raw/confidential corpus remains local and Git-ignored**
- Future merchandise authority: **Supabase and the Tile Concept app after schema freeze and reconciled migration**
- Customer feedback and Google review handoff: **implemented locally on 2026-09-01 with private schema/RLS, five-question staff capture, optional private photo, deterministic/LLM draft, expiring customer link, WhatsApp handoff, customer confirmation, and click-only Google tracking**
- Existing walk-in UI contract: **preserve the current one-by-one phone lookup, identity review, and manual entry path; feedback remains optional and post-purchase**

## Start here

- [Product Requirements Document](<./Tile Concept OS - Product Requirements Document.md>)
- [Source Register](<./Source Register.md>)
- [Catalog Ingestion Architecture](<./Catalog Ingestion Architecture.md>)
- [Canonical Merchandise Schema](<./Canonical Merchandise Schema.md>)
- [White Horse Ingestion Pilot](<./White Horse Ingestion Pilot.md>)
- [Obsidian Discovery Corpus](<./Discovery Corpus/README.md>)
- [Discovery Inventory Summary](<./Discovery Corpus/Inventory Summary.md>)
- [Corpus Extraction Report](<./Discovery Corpus/Corpus Extraction Report.md>)
- [Field Observation Registry](<./Discovery Corpus/Field Observation Registry.md>)
- [Provisional Record Extraction Report](<./Discovery Corpus/Provisional Record Extraction Report.md>)
- [Visual Corpus Extraction Report](<./Discovery Corpus/Visual Corpus Extraction Report.md>)

## Working product name

`Tile Concept OS` is a working title. The UI may use `TC Command Centre` if the business prefers a shorter operational label. Naming does not change scope.

## Accepted technical direction

- Dedicated GitHub application repository with protected `main` and pull-request review.
- Next.js 16 App Router, React 19, strict TypeScript, Node.js 24 LTS, and pnpm.
- Vercel for application hosting, Node functions, preview deployments, production delivery, and environment-scoped configuration.
- Supabase for PostgreSQL, Auth, private Storage, selected Realtime, Queues, migrations, and generated database types.
- Tailwind CSS 4, owned shadcn/Radix components, Geist Sans/Mono, Lucide, TanStack Table/Virtual, and FullCalendar Standard for the EFFEN-derived command-centre UI.
- Server-first reads and commands, explicit RLS/authorization, private originals, durable background jobs, and human-reviewed OCR/import publication.

The current folder remains the product source of truth inside the broader `nadeemramli/build-blog` knowledge-vault repository. Application code lives separately in `nadeemramli/tile-concept` at `/home/nadeemramli/workspace/github.com/nadeemramli/tile-concept`; production data must not be copied back into this vault.

## Core modules

1. Sales Command Centre
2. Lead and Inquiry Inbox
3. Accounts, Contacts, Projects, and Opportunities
4. Walk-in Registration and Purchase Capture
5. Marketing Opportunities and Shoot Calendar
6. Customer Feedback and Google Review Handoff
7. Product Catalog and Asset Library
8. Pricing and Price History
9. Stock and Supplier Availability
10. Imports, OCR, and Review Queue
11. Integrations and Data Health
12. Reports, Audit, and Administration

## Immediate rollout decision needed

The application repository and first vertical slice now exist. Before the feedback module goes live, complete the PRD launch gates, approve the private-feedback benefit policy, add the owner-verified Google Business Profile review URL, approve the LLM/privacy configuration, apply the migration to the hosted Supabase project, and deploy the reviewed branch through Vercel. The established core slice is:

> Capture or register an inquiry → resolve the customer safely → create a project opportunity → search a governed product and price → record or link a quote/purchase → retain the history for repeat purchase.

The implemented additive slice is:

> Existing purchase succeeds unchanged → staff optionally records five neutral answers and photo permission → customer receives one secure WhatsApp link → customer confirms/edits their own draft → customer may voluntarily open the correct Google review form.
