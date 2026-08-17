# MCSW Shop Brain invariants

These are product rules, not suggestions.

- The live `/ops` application is evolved additively. Never rename, drop, or change the type of a live column or table.
- Neon is one shared database across development, previews, and production. Migrations in `scripts/migrate.mjs` must be idempotent and safe to run repeatedly.
- Persist intent or provider payload before any email, SMS, push, Blob upload, AI call, or other side effect.
- Every SQL interpolation must carry an explicit Postgres cast (`::bigint`, `::boolean`, `::text`, `::timestamptz`, `::jsonb`, etc.). This prevents Neon `42P18` failures.
- `[INTERNAL TEST]` and `is_test` survive every intake, person match, event, notification, extraction, digest, brief, and export path. Tests never alert crew or count as business.
- `events` is immutable. Correct `claims` with a replacement plus `superseded_by`. `lead_events` remains only as a compatibility journal while the app dual-writes.
- Provider ingestion is idempotent by external ID. Twilio webhooks reject missing or invalid signatures.
- Crew money is removed server-side. Hiding it in CSS or React is not authorization.
- Roles are exactly `owner` and `crew`.
- No worker surveillance. Never add per-worker hours, activity totals, response rankings, read receipts, leaderboards, location trails, or productivity reports—even behind an owner flag. Operator attribution is only a byline explaining who changed a customer record.
- Call precedes Text. Voice precedes keyboard where configured providers and the browser support it.
- Internal UI extends the physical Shop Wall vocabulary and remains high-contrast for a full workday: no glowing text, candy palette, hazard stripes, or faint secondary copy.

## Always use delegate-to-pi

For any non-trivial reading, discovery, or code changes, use the delegate-to-pi skill. Call Pi with deepseek-v4-flash (or deepseek-v4-pro for hard reasoning). Your role is to plan, review, and decide. Do not do heavy exploration or implementation yourself.

## Which delegate

Pi is the default. One cheap process, and it covers reading, discovery, and single-file changes.

Use the `factory` skill instead only when there are **3 or more genuinely independent tasks**, or when I say "run the factory." It fans Codex `gpt-5.6-sol` at `xhigh` across isolated worktrees through Herdr, then reviews and merges serially. Cap is 4 implementers in flight — it is the most expensive configuration on this machine, so it does not fire on small work.

Herdr must already be open. Never start its server behind my back, and never close a tab or pane you did not create.

# Model Routing & Delegation

## Default
- **Pi** is the default worker.
- Use it for reading, discovery, exploration, and single-file (or small, tightly scoped) changes.
- Prefer the cheapest capable model for routine work.

## Orchestrator
- The current working model is the **orchestrator**.
- It owns the overall plan, decides what to delegate, reviews results, and keeps context coherent.
- It does **not** do bulk implementation itself when a cheaper model can handle it.

## Cheap / Small Work
Route to **Pi** (or DeepSeek-class models) when the task is:
- Reading or summarizing files / code
- Discovery or exploration
- Single-file or small, localized edits
- Straightforward implementation with clear acceptance criteria

## Review / Dispute / High-Stakes Work
Send to **Codex `gpt-5.6-sol` at `xhigh`** when:
- Work needs review, critique, or verification
- There is a dispute, rebuttal, or argument to evaluate
- Open questions remain after a cheap pass
- Architectural, correctness, or security-sensitive decisions are involved
- The user explicitly asks for a strong review

When sending work to Codex:
- Package tightly: goal, relevant files/diffs, specific claims or open questions, and desired output format.
- Do not dump the entire conversation.

## Factory Mode
Use the `factory` skill **only** when:
- There are 3 or more genuinely independent tasks, **or**
- The user explicitly says “run the factory”

Factory fans Codex `gpt-5.6-sol` at `xhigh` across isolated worktrees via Herdr, then reviews and merges serially.  
Hard cap: 4 implementers in flight. This is the most expensive configuration — do not use it for small work.

## Principles
1. Default to cheap. Escalate only when quality or risk justifies it.
2. Keep the orchestrator in the loop for all decisions and merges.
3. Prefer explicit hand-offs with clear acceptance criteria over vague “please review.”
4. After a Codex review, the orchestrator decides: accept, send targeted follow-up to a cheap model, or escalate again.
