# Opportunity workflow and private photos

Implemented on the F1–F3 reporting base. Hosted databases and deployments have not been changed.

## What changed

- New opportunity is available from Pipeline, a company, a contact, or an existing project. A company may be saved without opportunities and receive one later. Opportunities no longer require creating an artificial physical project.
- A company has separate **New contact** and **Link existing contact** actions. Existing contact/company creation is retained.
- Combined project plus opportunity creation is one database transaction. A failed opportunity or history write cannot leave an orphan project. Creation retries reuse the original request.
- Edits and reassignment check ownership and record version in the database. A stale editor must refresh instead of silently overwriting another person's work. Empty estimated values remain unknown.
- Archive is the reversible way to undo a mistaken opportunity. The Archived pipeline view supports restoration with a reason. Contacts, projects, photos and linked sales remain intact. Existing tasks remain available in Tasks; archive does not silently cancel them.
- Private opportunity photos support JPG, PNG and WebP up to 5 MB, with a required remark. Staff access follows the opportunity's ownership/read scope. Upload intent is not treated as a completed photo until Storage confirms the object. Photos cannot be overwritten; removal retains an audit/timeline reason. Signed viewing URLs expire after five minutes; a URL already issued may remain usable until then.
- Company/contact search now has labels, keyboard selection and stale-response protection. Dialog navigation waits for URL query updates to finish. Forms scroll on small screens; the opportunity drawer uses the full mobile width and focuses its title instead of opening a tooltip over the controls.

An opportunity marked Won is a sales pursuit outcome. Recorded revenue and collections still come exclusively from the F3 documented purchase workflow.

The separate Microsoft-backed project progress media worktree was inspected for compatibility and remains untouched. This feature stores internal opportunity evidence; it does not migrate that project's media library or grant marketing publication permission.

## Staff QC

Use synthetic records in a local/preview workspace. Local manager login: `demo.manager@tileconcept.test` / `TileDemo!2026`.

1. Accounts & Contacts → Account: create a test company with no contact or opportunity. Open its record and confirm all three lists are empty.
2. Click **New opportunity**, enter a name, next action and Malaysia-time due date. Save. Expect the opportunity drawer, the company link, and no invented physical project.
3. Click **Edit**. Change the name/remark/due date. Save and reload. Expect the edits and a timeline entry to remain. Leave value blank and confirm it stays unknown.
4. Click **Add photo and remark**. Upload a harmless JPG/PNG/WebP and explain it. Confirm the image, caption, timestamp and timeline entry. Retry an invalid type or file above 5 MB and expect an error.
5. Archive with a reason. Expect the record to leave active pipeline views, remain reachable in **Archived**, and keep its photo/history. Restore with a reason and confirm it resumes its previous stage.
6. Open the company and use **New contact**; confirm the new contact is linked to it. From the contact, create a second opportunity. Also verify **Link existing contact** does not create a duplicate person.
7. Open the same opportunity in two tabs. Save a change in one, then save the older form in the other. Expect a refresh conflict, with no overwrite.
8. As a salesperson, try another salesperson's opportunity. It must not be editable or expose private photos. A sales manager can reassign it to an active workspace member.
9. At a phone-size viewport, verify drawer actions and long forms can be reached by scrolling and keyboard.

## Verification

- 39 pgTAP assertions cover company-only creation, ownership, stale writes, retries, required next actions, private media, authenticated Storage uploads, archive/restore, no invented purchases, and rollback without orphan projects.
- TypeScript passes. Full unit suite: 148 passed. Lint has zero errors and the existing TanStack React Compiler warning.
- Browser checks: company created alone, opportunity added later, persisted edit, real private PNG upload and caption, archive, restore, and mobile drawer inspection. The Storage policy's ambiguous `name` reference found during browser testing was corrected and covered by an authenticated upload test. A fresh page then had zero console errors/warnings.
- Final combined build, clean migration replay, database advisors and cross-feature checks are coordinated in the reporting integration worktree.

Migration: `supabase/migrations/20260921045534_opportunity_workflow.sql`.
Regression suite: `supabase/tests/012_opportunity_workflow.sql`.

Integration note: generated database types are regenerated centrally. Existing operational consumers outside this package should exclude `archived_at IS NOT NULL`; historical purchases and financial totals must retain their linked evidence. Pipeline and company/contact/project lists do this in this package. The inherited pipeline list limit is still 2,000 records; scale/load verification is separate from this workflow repair.
