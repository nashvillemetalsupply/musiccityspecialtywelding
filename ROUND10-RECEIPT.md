# Round 10 receipt

Branch `form-p2-r4-1127` from `8e04893`.

- R10-1 uses the legacy form photo count only when the snapshot proves it and there are zero reservation rows. Test `a pre-upgrade quote with no reservations requires its original photo on retry`.
- R10-2 retains the canonical key and returns a duplicate when a test notification has provider send evidence. Test `production keeps the canonical key for a legacy test alert with an accepted send`.
- R10-3 logs the failed call SID and continues reconciling the remaining calls. Test `raw call reconciliation recovers the younger call after an immutable journal link fails`.

`npm run typecheck` and `git diff --check` passed. `npm test` reported 1,771 tests, with 1,768 passed, 3 skipped, and 0 failed. The skips were the opt-in AI evaluation and two tests that require `DATABASE_URL`.

BUILD: PASS
