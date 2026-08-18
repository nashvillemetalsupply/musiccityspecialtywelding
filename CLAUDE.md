# MCSW Shop Brain Invariants

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

# Model Routing and Delegation

The current working model is the **orchestrator**.
It owns the plan, decides what to delegate, reviews results, keeps context coherent, and owns every merge. Delegate the actual work.

## Pi is the default

Use the `delegate-to-pi` skill for:

- Reading, discovery, and exploration
- Single-file or small localized edits
- Straightforward implementation with clear acceptance criteria

Prefer `deepseek-v4-flash`. Use `deepseek-v4-pro` only for harder reasoning.

Hand off explicitly: goal, relevant files, and acceptance criteria.

## Escalate to Codex for review and high-stakes work

Send to Codex `gpt-5.6-sol` at `xhigh` when:

- Work needs review, critique, or verification
- There is a dispute, rebuttal, or argument to evaluate
- Open questions remain after a cheap pass
- The decision is architectural, correctness-sensitive, or security-sensitive
- I explicitly ask for a strong review

Package tightly: goal, relevant files/diffs, the specific claims or open questions, and the desired output format. Send only that package.

After a Codex review, the orchestrator decides: accept, send a targeted follow-up to Pi, or escalate again.

## Factory mode

Use the `factory` skill **only** when there are 3 or more genuinely independent tasks, or when I say "run the factory."

- Fans Codex `gpt-5.6-sol` at `xhigh` across isolated worktrees through Herdr
- Reviews and merges serially
- Hard cap: 4 implementers in flight
- Most expensive configuration — do not use on small work

Herdr must already be open. Never start its server. Only close tabs and panes you created yourself.

## Communication & Completion

All agents must speak in plain, direct English. No fluff.

**When the task is fully done:**

1. State what was done in 1–3 short sentences.
2. End with exactly this line:
   **This task is completely done. It is safe to clear this chat.**
3. Optionally add one short recommendation.

**When more information is needed:**

- Ask clear, specific questions.
- Give a recommendation on the best next step.
- Do not add extra explanation.

Keep the ending short and obvious. The owner should never have to dig or interpret what to do next.
