# Walk-in feedback and Google review handoff

This extends the existing private feedback module to showroom visits without requiring a purchase. Staff can prepare five neutral customer answers, obtain WhatsApp agreement and separate customer media permission, capture/upload up to six photos, and prepare one WhatsApp message linking to the draft and photos. The customer edits their own wording and chooses whether to submit on Google.

## What changed

- Walk-in completion and visit drawers open the feedback flow. Visit rows show request/review status; earlier customer-reported or staff-verified Google reviews are visible when opening a later visit or request.
- The request can be reopened from its visit or the paginated feedback tracking table. Lost/expired private links can be replaced without duplicating answers; replacing a link invalidates the old token. Staff can revoke sharing with a reason.
- WhatsApp opening, staff marking the message sent, customer confirming private feedback, opening Google, customer reporting a posted review, and staff verifying a review are separate facts. Review outcomes/corrections require notes and leave events/audit evidence.
- Customer links now bypass staff login only on the narrowly matched bearer-token route. Tokens remain server-verified, hashed in the database, expiring after seven days, and revocable. Customer pages/redirects use no-store/no-referrer.
- Images use direct authenticated Storage uploads and immutable pre-authorized paths. This fixes the old 10 MB image form being rejected by Next's default 1 MB Server Action limit. Uploads are JPEG/PNG/WebP, maximum 5 MB each. A database photo intent does not count as an uploaded image. Customer token endpoints return only this request's uploaded images.
- Showroom staff get the narrow `feedback.send` permission for an audited visit/purchase recipient lookup; generic contact phone/email reveals remain unchanged.
- New UI does not offer review incentives. Existing private-feedback benefits remain recorded, but their requests do not expose a Google handoff.

## Configuration before real use

Set **`TC_GOOGLE_REVIEW_URL`** in the deployment environment to the owner's verified Google Business Profile **Get more reviews** link. It must be HTTPS on an allowed Google domain. There is no new settings-screen field. The same existing environment variable is used throughout the feedback module; do not invent a Place ID or use the synthetic test URL. Redeploy after changing a production environment variable. Also verify **`NEXT_PUBLIC_APP_URL`** is the actual public HTTPS application origin, and the existing server-only Supabase secret is configured for the narrowly scoped customer-token RPCs.

The staff page explicitly shows when the destination is missing. Previously prepared non-incentivized requests with no stored destination use the configured destination once it becomes available. A stored destination remains stable. Configuration currently supports one business review destination per app environment; multi-location destination routing is not implemented.

WhatsApp uses click-to-chat: the app opens an editable message and staff presses Send. The message carries a private page containing images; click-to-chat cannot attach images automatically. On the customer page, copy the draft and save any photos, then open Google. The customer chooses their Google account/rating, pastes or edits text, uploads photos and submits. No Google posting API or WhatsApp automatic sender was introduced.

Primary capability references verified 2026-09-21: [Google review link instructions](https://support.google.com/business/answer/16816815?hl=en-GB), [Google Business Profile review API](https://developers.google.com/my-business/content/review-data), and [WhatsApp click-to-chat](https://faq.whatsapp.com/5913398998672934).

## Staff QC journeys

Use synthetic customers in a local/test workspace. Never send the test message to a real customer.

1. Sign in as showroom staff. Record a walk-in for a resolved customer with a phone number and no purchase. Click **Customer feedback & Google review** on the completion screen, or open that visit and **Prepare feedback & Google review**.
2. Record at least two answers, including a critical/mixed answer. Confirm the customer agreed to receive the WhatsApp link. The same Google path remains available regardless of sentiment. Missing agreement or fewer than two answers should stop preparation.
3. Select customer media permission, continue, and choose or capture two photos. Upload them. A photo over 5 MB or unsupported type is refused; no permission means the photo uploader is absent. Verify the uploaded count and retry feedback.
4. Inspect the message and recipient. Opening WhatsApp alone must not mark it sent. In a controlled test, simulate **I sent this message in WhatsApp** and verify the sent status persists after refresh. No automated delivery is claimed.
5. Open the private link in a browser with no staff login. Check/edit the wording, see/download photos, and confirm private feedback. Copy the draft and open Google (only with an approved real destination when doing a real customer test). Confirm no text, rating or photo is silently posted.
6. Return to the visit. The request still opens, private confirmation and Google opening have separate timestamps, and the review stays **Unknown** until staff records an outcome. Record **Customer says posted**, then **I verified the Google review** with evidence; verify the distinction, reason and activity history.
7. Open a later visit for the same customer: the earlier reported/verified review should be visible. A link click alone must not appear as an existing posted review.
8. Reload a request after losing its link. Use **Prepare replacement link**; the previous link must fail. Revoke with a reason; both the customer page and photo endpoints must stop returning the content. Feedback tracking is paginated with older requests reachable.

## Validation and remaining limits

- TypeScript passed. Full ESLint: zero errors, existing TanStack compiler warning only.
- 41 new pgTAP assertions passed: visit-only creation, consent, duplicate recovery, separate sent/review states, photo upload RLS, multi-photo customer access, rotation/revocation, role denial, tenant isolation and inconsistent historical foreign references.
- Added four schema tests; all nine feedback/WhatsApp focused unit tests pass. The existing suite had 148 tests; the full 152-test run caught a wording assertion, which was corrected and its affected suite rerun successfully. Root integration should run the combined suite once after cherry-picks.
- Browser QC passed as showroom staff: two neutral/critical answers, separate media agreement, actual 2 MB image upload, request persistence, anonymous customer view and private confirmation. Mobile 390×844 screenshot inspected. Customer Google route returned 307 to a synthetic configured destination without navigating to or posting on Google. Both browser contexts reported zero console errors/warnings.
- Synthetic browser records/media were removed after QC. No hosted database, real customer, real WhatsApp message or Google review was touched.
- Phone camera capture is offered through the browser file input; device-specific camera/gallery behavior and real WhatsApp/Google account handoff need human phone QC. HEIC conversion is not included.
- Photo selection retry preserves its upload ID while the page stays open. Abandoned upload intents consume one of the six slots; cleanup/reclaim after leaving mid-upload is not yet exposed in UI. Customer media permission must be recorded during preparation; this version can continue without photos or revoke sharing, but does not edit the original agreement.
- Production build, clean migration replay, combined DB advisors/lint and cross-feature integration remain the root task's checks.
