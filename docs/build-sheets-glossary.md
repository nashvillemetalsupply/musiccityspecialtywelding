# Build Sheets glossary

These are the owner-approved words for the Builds workspace. Architecture and database names can remain precise in code; the screen uses shop language.

| Architecture term | Screen says | Meaning in the shop |
|---|---|---|
| Living Job | Job | The existing job record; no product-wide rename. |
| Proposed claim | Heard on call | A fact with saved evidence that the owner has not accepted. |
| Accepted fact | Confirmed | A fact the owner chose for the current draft. |
| Contradiction | Doesn't match | Competing readings or values that require an owner decision. |
| Unknown | Still need | A required fact that has no usable value yet. |
| Assumption | Shop estimate | An explicitly provisional value. It never makes a critical dimension fabrication-ready. |
| Released revision | Build Sheet 1, Build Sheet 2 | A numbered, dated, immutable snapshot of accepted facts. |
| Stale after a dimension change | Old numbers | Paperwork remains a valid record of its source Build Sheet but is no longer current for the job. |
| Stale after material, finish, or hardware change | Needs update | Paperwork needs a named non-dimensional change. |
| Proposed change pending review | Hold — change needs review | Dependent Paperwork cannot be treated as current until the proposal is accepted or rejected. |
| Artifact bundle | Paperwork | Drawings, DXF manifests, and other outputs tied to one named Build Sheet. |
| Workspace | Builds | The owner-only internal-test page linked from a job. |
| Customer projection | What We Understand | A dedicated allowlist of customer-safe facts from one locked Build Sheet. It is not an owner screen with fields hidden. |
| Customer acceptance | Looks right | The customer confirms one safe fact exactly as shown. |
| Customer correction | Needs a correction | A proposed replacement fact for owner review. It starts a new draft and never changes a locked sheet. |
| Issued paperwork | Issued from Build Sheet N | A deterministic drawing or DXF whose exact locked source and content hash were recorded. |
| Issue blocked | Cannot issue as current | The Paperwork is stale, on Hold, tied to an older sheet, or lacks fabrication readiness required by its format. |
| Clarification bridge | Ask on this call | A specific question that names the missing reference needed to make a critical fact usable. |
| Closeout review | Review closeout | The structured completion record derived from the owner's one-breath note before the existing completion gesture. |
| Completion | Finish job | Operational work completion only. It does not mean paid. |

## Usage rules

- Say “Build Sheet 1,” not “version,” “revision entity,” or “artifact snapshot.”
- Say “From the call” for the evidence link.
- Say why fabrication is blocked; do not imply that a Shop estimate is confirmed.
- “Old numbers” is a hard current-use stop, not deletion. The original Paperwork record remains auditable.
- The initial slice is visible only for `[INTERNAL TEST]` jobs when `SHOP_BRAIN_LIVING_JOB` is exactly `true` after trimming and lowercasing.
- Keep payment words out of completion and closeout controls. Paid and finished are independent states.
- Never describe stale Paperwork as current, even when its original file remains downloadable from its historical record.
