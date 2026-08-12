# Build Sheets glossary

These are the owner-approved words for the Builds workspace. Architecture and database names can remain precise in code; the screen uses shop language.

| Architecture term | Screen says | Meaning in the shop |
|---|---|---|
| Living Job | Job | The existing job record; no product-wide rename. |
| Proposed claim | Heard on call | A fact with saved evidence that the owner has not accepted. |
| Accepted fact | Confirmed | A fact the owner chose for the current draft. |
| Contradiction | Doesn't match | Competing readings or values that require an owner decision. |
| Unknown | Still need | A required fact that has no usable value yet. |
| Assumption | Working number | An explicitly provisional value. It never makes a critical dimension fabrication-ready. |
| Released revision | Build Sheet 1, Build Sheet 2 | A numbered, dated, immutable snapshot of accepted facts. |
| Stale after a dimension change | Old numbers | Paperwork remains a valid record of its source Build Sheet but is no longer current for the job. |
| Stale after material, finish, or hardware change | Needs update | Paperwork needs a named non-dimensional change. |
| Proposed change pending review | Hold — change needs review | Dependent Paperwork cannot be treated as current until the proposal is accepted or rejected. |
| Artifact bundle | Paperwork | Drawings, DXF manifests, and other outputs tied to one named Build Sheet. |
| Workspace | Builds | The owner-only internal-test page linked from a job. |

## Usage rules

- Say “Build Sheet 1,” not “version,” “revision entity,” or “artifact snapshot.”
- Say “Exact utterance” for the evidence link.
- Say why fabrication is blocked; do not imply that a Working number is confirmed.
- “Old numbers” is a hard current-use stop, not deletion. The original Paperwork record remains auditable.
- The initial slice is visible only for `[INTERNAL TEST]` jobs when `SHOP_BRAIN_LIVING_JOB` is exactly `true` after trimming and lowercasing.
