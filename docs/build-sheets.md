# Build Sheets initial slice

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
