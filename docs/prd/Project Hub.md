---
title: Tile Concept OS - Project Hub
description: Entry point for the Tile Concept sales, product, pricing, catalog, and stock operating system.
created: 2026-08-19
updated: 2026-08-20
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
- Application scaffold in this folder: **not present; documents only as of 2026-08-20**
- Build authorization: **not yet recorded**
- Design-system rights gate: **open**
- SQL Account access and behavior validation: **open**
- Representative source files and API credentials: **not yet supplied**
- Production customer data: **must not enter the repository or this vault**

## Start here

- [Product Requirements Document](<./Tile Concept OS - Product Requirements Document.md>)
- [Source Register](<./Source Register.md>)

## Working product name

`Tile Concept OS` is a working title. The UI may use `TC Command Centre` if the business prefers a shorter operational label. Naming does not change scope.

## Accepted technical direction

- Dedicated GitHub application repository with protected `main` and pull-request review.
- Next.js 16 App Router, React 19, strict TypeScript, Node.js 24 LTS, and pnpm.
- Vercel for application hosting, Node functions, preview deployments, production delivery, and environment-scoped configuration.
- Supabase for PostgreSQL, Auth, private Storage, selected Realtime, Queues, migrations, and generated database types.
- Tailwind CSS 4, owned shadcn/Radix components, Geist Sans/Mono, Lucide, TanStack Table/Virtual, and FullCalendar Standard for the EFFEN-derived command-centre UI.
- Server-first reads and commands, explicit RLS/authorization, private originals, durable background jobs, and human-reviewed OCR/import publication.

The current folder is part of the broader `nadeemramli/build-blog` knowledge-vault repository; it is not itself a Next.js application repository. Keep this PRD as the product source of truth and create or identify the dedicated app repository before implementation.

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

Approve or amend the v1 scope and answer the PRD's decision gates before implementation begins. The first build should prove one end-to-end vertical slice:

> Capture or register an inquiry → resolve the customer safely → create a project opportunity → search a governed product and price → record or link a quote/purchase → retain the history for repeat purchase.
