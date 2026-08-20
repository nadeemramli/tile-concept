# Docs

Product decisions are made in the Obsidian Build Vault (`5. Idea Vault/1. Internal
Application/Tiles Concept - Backend Management/`). Everything here is a dated snapshot of
that vault, kept in the repo so the reasoning sits next to the code that implements it.
Transactional facts live in the app database, not in documents (PRD §2.2 principle 10).

## `prd/` — product source of truth (snapshot 2026-08-21)

- [`Tile Concept OS - Product Requirements Document.md`](prd/Tile%20Concept%20OS%20-%20Product%20Requirements%20Document.md)
  — scope, functional requirements, data model, technical architecture. §7.12 is the
  visual-ingestion acceptance boundary.
- [`Project Hub.md`](prd/Project%20Hub.md) — status, accepted direction, what is currently blocking.
- [`Source Register.md`](prd/Source%20Register.md) — every piece of evidence the product design rests on, and its limits.

## `architecture/` — the schema and the pipeline

- [`Canonical Merchandise Schema.md`](architecture/Canonical%20Merchandise%20Schema.md)
  — v0.3, the contract for brands, organizations, products, variants, catalogs, prices,
  certificates, visual media, and source provenance.
- [`Catalog Ingestion Architecture.md`](architecture/Catalog%20Ingestion%20Architecture.md)
  — Drive → discovery → Supabase, the pipeline stages, and the review gates.
- [`Corpus Compatibility Map.md`](architecture/Corpus%20Compatibility%20Map.md)
  — **how v0.3 maps onto the schema that actually exists**: what was evolved, what was
  added, what each gate now refuses, and where every corpus dataset landed. Start here if
  you are working on ingestion.

## `discovery/` — the 2026-08-21 corpus archive

A dated record of what was found in the three accepted Google Drive roots and what state
it was in. These are historical observations; where a later pass contradicted an earlier
one, the correction is marked inline rather than the original being rewritten.

- [`README.md`](discovery/README.md) — the corpus layout and the soft-schema rule.
- [`Inventory Summary.md`](discovery/Inventory%20Summary.md) — 242 files, 131 folders, zero traversal errors.
- [`Corpus Extraction Report.md`](discovery/Corpus%20Extraction%20Report.md) — what was readable, and the three explicit exceptions.
- [`Field Observation Registry.md`](discovery/Field%20Observation%20Registry.md) — which field signals appear in which documents.
- [`Provisional Record Extraction Report.md`](discovery/Provisional%20Record%20Extraction%20Report.md) — the candidate records and the publication blockers.
- [`Visual Corpus Extraction Report.md`](discovery/Visual%20Corpus%20Extraction%20Report.md) — media assets, pixel observations, and the deferred pair.
- [`White Horse Ingestion Pilot.md`](discovery/White%20Horse%20Ingestion%20Pilot.md) — the single-brand pilot that established the pattern.

**The corpus itself is not in this repository.** `Discovery Corpus/_local` (~3.1 GB of
supplier originals, extractions, page renders, and provisional records) stays on the
operator's machine, Git-ignored, and reaches Supabase only through `scripts/corpus/`.

## Elsewhere

- [`Backlog.md`](Backlog.md) — engineering gaps, verification debt, production hardening.
- Root [`README.md`](../README.md) — setup, scripts, hosted project, corpus commands.
- [`CLAUDE.md`](../CLAUDE.md) — engineering conventions.
