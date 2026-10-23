# O1 exit check (roof jobs tabs)

Under 2 minutes. Nothing is seeded in production; the owner makes the only rows, ticked "Test entry", so they stay out of every number.

Before this check: `npm run migrate` has run once against the shared Neon database (creates `roof_jobs`), then the build is deployed. If the LD2R tab shows an error page, the migration did not run.

## Owner (phone or laptop, signed in to /board)

1. Tap the **Grease Patrol** tab. You see a **Grease Patrol ops** button and no add form. Tap it: the Grease Patrol ops page opens in a new tab.
2. Tap the **LD2R** tab. Fill Customer name `TEST O1`, Amount `1`, tick **Test entry**, tap **Add booked job**. The row appears at the top: `TEST O1 · Booked · TEST`.
3. On that row tap **Mark paid**. It changes to `TEST O1 · Paid $1.00 · TEST`.
4. Tap the **Railing** tab. Add Customer name `TEST O1 RAIL`, leave Amount empty, tick **Test entry**, tap **Add booked job**. On that row the Mark paid button has an Amount box. Type `2`, tap **Mark paid**. The row shows `Paid $2.00`.
5. Tap the **BuilderBox** tab. It loads with the add form and the jobs list.

## Crew (their own phone, signed in to /board)

6. Tap **LD2R**. The page loads, there is no Test entry box, and the owner's `TEST O1` row is **not** in the list.

Pass = all six steps look as written. Any step that does not: send the step number.

The test rows stay in the table, marked test, and never reach the booked-jobs export.
