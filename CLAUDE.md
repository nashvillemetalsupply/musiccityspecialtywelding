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

# Model routing and delegation

The current working model is the **orchestrator**. It owns the plan, decides what to delegate, reviews results, keeps context coherent, and owns every merge. Delegate the work itself.

## Pi is the default

Use the `delegate-to-pi` skill for reading, discovery, exploration, single-file or small localized edits, and straightforward implementation with clear acceptance criteria. Call Pi with `deepseek-v4-flash`, or `deepseek-v4-pro` for hard reasoning.

Hand off explicitly: goal, relevant files, and acceptance criteria.

## Escalate to Codex for review and high stakes

Send to Codex `gpt-5.6-sol` at `xhigh` when:

- Work needs review, critique, or verification
- There is a dispute, rebuttal, or argument to evaluate
- Open questions remain after a cheap pass
- The decision is architectural, correctness-sensitive, or security-sensitive
- I ask for a strong review

Package tightly: goal, relevant files and diffs, the specific claims or open questions, and the output format you want. Send that package alone.

After a Codex review the orchestrator decides: accept, send a targeted follow-up to Pi, or escalate again.

## Factory mode

Use the `factory` skill only when there are **3 or more genuinely independent tasks**, or when I say "run the factory." It fans Codex `gpt-5.6-sol` at `xhigh` across isolated worktrees through Herdr, then reviews and merges serially. Cap is 4 implementers in flight — the most expensive configuration on this machine, so it stays off small work.

Herdr must already be open before factory runs. Leave its server for me to start, and close only tabs and panes you created yourself.
