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
