# Deployed shared sales policy regression coverage

Test-only changes based on `0cd567a`. No application code, schema, grant, migration, or production state changed. The separate owner-scoped-edit candidate is not included.

The production grant recorded in `20260921073229_sales_rep_review_and_reports.sql` gives `sales_rep` `sales.read_all`, `review.approve`, and `report.read`. In the existing implementation, `sales.read_all` also bypasses owner checks when combined with `sales.write`. These tests describe that deployed shared-edit behavior; they do not introduce a new policy.

A fresh, isolated local stack reproduced exactly 20 failures in the prior suite: 001 (1), 006 (2), 008 (3), 011 (1), 012 (11), and 014 (2). Eight opportunity failures followed from a teammate archive succeeding where the old test expected denial. The updated workflow explicitly verifies shared archive and restore before testing subsequent photo and report behavior.

Existing tests now expect shared inquiry responses/conversion, workflow completion after reassignment, remarks, task/photo visibility, opportunity archive/restore, and report/history access. They retain required business validations. Additional state checks verify completion counts, archive state, and the real remark author.

New `018_shared_sales_policy.sql` adds 51 assertions covering:

- Same-workspace shared inquiry, follow-up, opportunity stage/edit/photo, and general task changes, including persisted results and actual actor attribution.
- Retention of the assigned inquiry owner during shared work; `sales.assign` and settings administration remain unavailable to sales reps.
- Cross-workspace SELECT, UPDATE, and RPC denial, with unchanged foreign records verified afterward.
- Showroom's narrower owner restrictions and management's actual read-only UPDATE/RPC behavior, including records owned by that management fixture.

The photo workflow still requires the original uploader to finish their reservation. A shared editor can prepare/upload/finalize their own photo on a teammate opportunity but cannot finalize another person's reservation. Showroom report denial, anonymous denial, marketing-ledger restrictions, idempotency, and evidence requirements remain tested.

Verification: all 19 SQL files pass, **669 assertions total**, against synthetic migrations and all four seed files in the independent `tile-concept-shared-sales-tests` stack (API 65321, database 65322). `git diff --check` passes. No application tests/build were rerun for this SQL-test-only change; root owns combined application validation and release. The isolated stack was stopped after verification. The original private corpus and root development databases were not modified.

This coverage pins the existing policy and selected meaningful boundaries. It is not a claim that every historical child-table write path has been exhaustively audited. Broader permission redesign would require separate scope.
