# Build Sheets

Builds turns Call Sketch evidence into an owner-decided, immutable Build Sheet and a dependency-aware Paperwork manifest. The initial slice is deliberately owner-only, flag-off by default, and hard-partitioned to test jobs.

## Data path

1. Saving a test Call Sketch draft creates an explicit call-to-job bridge.
2. Call observations become idempotent `build_fact` claims linked to the exact transcript event.
3. Owner choices append decision records. Rejected facts remain history; they are not deleted.
4. Locking copies accepted facts into the next immutable, per-job Build Sheet snapshot.
5. Paperwork records both its source Build Sheet and the exact facts it consumed.
6. A proposal places only dependent Paperwork on Hold. A released changed sheet marks only changed dependents Old numbers or Needs update.

The pure rules live in `lib/build-sheets-domain.mjs`; database and UI code are adapters around that module.

## Safety and rollback

- Access requires an authenticated owner, `SHOP_BRAIN_LIVING_JOB=true`, and a job row with `is_test = true`.
- Every Builds read and mutation repeats the test predicate in SQL.
- The slice writes no notifications, Needs Attention items, customer messages, or Morning Brief lines.
- Operational rollback is flag off plus branch abandonment or a code revert. Additive tables and test fixture rows remain inert and auditable.
- Do not enable the production flag, merge to `main`, or expose Builds to live jobs without explicit owner approval.

## Kill test checkpoint

After the migration prints the fixture path, open it on a phone-width screen:

1. Under Doesn't match, choose whether `48″` means the clear opening or finished gate. Confirm that reading and lock Build Sheet 1.
2. Correct the confirmed width, observe affected Paperwork show Hold — change needs review, confirm the correction, and lock Build Sheet 2.
3. Confirm that every width-dependent Build Sheet 1 item says Old numbers, unaffected items stay Current, and each item names its source Build Sheet and reason.

Stop at this checkpoint. Customer-visible continuation begins only after the owner reports that both movements passed.

## Post-kill-test continuation

The continuation remains flag-off by default and test-partitioned. It adds five linked capabilities without changing the meaning or immutability of a locked Build Sheet:

1. **Mobile Builds canvas.** The current locked sheet renders as a readable gate elevation with exact dimensions, hardware sides, source evidence, and fabrication blockers. It never derives a cut list.
2. **What We Understand.** A dedicated customer projection exposes only safe confirmed facts and asks for confirmation. A correction appends a proposed fact and returns the owner to a new draft; it never edits a locked sheet.
3. **Paperwork issue.** Drawing and DXF bytes compile deterministically from one locked sheet. Paperwork on Hold, with Old numbers, needing an update, or tied to a non-current sheet cannot be issued as current. DXF also requires fabrication readiness.
4. **Call clarification.** Live Call Sketch prefers a specific clarification question when a fabrication-critical dimension is missing its reference.
5. **Reviewed closeout.** The owner captures one short closeout statement and reviews structured completion details. A partial outcome files an owner-only update and keeps the job and promises open; a complete outcome uses the existing completion gesture. Completion never implies payment, and payment remains independent.

Customer confirmation and correction are intentionally restricted to internal-test jobs in this phase. Enabling the flag does not authorize live-customer exposure.

## Continuation invariants

- Customer pages are built from an explicit allowlist projection; owner data is never rendered and then hidden.
- Customer responses are idempotent and bound to an exact token, Build Sheet, claim, and event receipt.
- A correction creates a proposed claim plus a new draft state. Released snapshots remain immutable.
- Paperwork issue performs a final database recheck against the latest locked sheet and active dependency facts before recording an issue receipt.
- Rejected and superseded proposed facts do not make current Paperwork stale; active conflicting proposals do.
- Issued files name their exact Build Sheet and content hash. Historical files remain auditable, but stale files cannot be represented as current.
- Crew projections exclude money, customer-safe evidence details, and non-current Paperwork.
- Closeout writes a separate immutable receipt and does not read or write payment status.
- No continuation path emits customer notifications or consumes notification budget while restricted to internal-test jobs.
