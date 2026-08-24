---
name: mcsw-weekly-optimization
description: Run Music City Specialty Welding's evidence-driven weekly optimization across the website, Shop Brain CRM, SEO and local visibility, analytics, Google Ads, lead intake, and production reliability. Use when the owner asks for the weekly optimization, scale-readiness polish, or an across-the-board growth and operations audit; do not invoke for a single isolated bug or copy edit.
---

# MCSW Weekly Optimization

Run one closed-loop optimization pass from discovery through verified production truth. Invocation authorizes the audit; mutations still follow the user's requested scope and the approval gates below.

## Load the operating context

1. Read the repository `AGENTS.md` and `CLAUDE.md` completely.
2. Record the branch, working-tree state, latest commit, live deployment, and production health before changing anything. Preserve unrelated user work.
3. Use `growth-gaps`, `mainstreet`, and `service-shop-brain` when they are available. Use the signed-in browser control skill for Google, Vercel, and other dashboards. Continue with this runbook if a supporting skill is unavailable.
4. Identify each browser tab and account before acting. Never assume that Vercel, Ads, Analytics, Search Console, or Business Profile share a browser profile.

The audit is complete only when every material surface below has current evidence or is explicitly marked unavailable.

## Establish the weekly baseline

Use the current 7 days versus the previous 7 days for movement, with 28-day or 30-day context to prevent overreacting to a thin week. Record exact windows and data latency.

- Production: `/api/health`, deployment status, delivery failures, scheduler freshness, provider readiness, and recovery backlogs.
- Website: responsive layouts, overflow, broken media, navigation, call and quote paths, form acceptance, accessibility-critical controls, schema, canonical URLs, redirects, sitemap, robots, metadata, and real-user tracking behavior.
- Shop Brain: lead persistence, call/text/email ingestion, webhooks, transcript and attachment queues, automation runs, immutable receipts, role projections, and `[INTERNAL TEST]` isolation.
- Analytics: users, sessions, acquisition mix, accepted leads, conversion events, paid/organic attribution, internal traffic, and unusual source or landing-page changes.
- Search Console: clicks, impressions, position, queries, landing pages, indexing, sitemap state, and actionable crawl errors.
- Google Ads: spend, impressions, clicks, CTR, CPC, conversions, CPA, budget status, search terms, keyword match types, negatives, and conversion tracking. Inspect both the recent week and at least 30 days.
- Local visibility: Business Profile verification, business facts, review link, review velocity, and the consistency of name, address/service area, phone, and hours.
- Lead handling: quote delivery, response paths, missed-call recovery, follow-up queues, customer-facing errors, and any point where a qualified lead can disappear.

Exclude internal routes and explicit verification traffic from public marketing measurements. Never create synthetic production leads merely to make a dashboard look healthy.

## Decide what deserves change

Rank findings in this order:

1. Broken lead capture, provider authentication, unsafe data flow, or false health signals.
2. Missing or polluted conversion measurement.
3. Demonstrable paid-search waste or unsupported intent.
4. Conversion friction on high-traffic public paths.
5. Indexing, local visibility, and content opportunities supported by query evidence.
6. Experiments with a named hypothesis and a way to measure the result.

Tie every change to observed evidence. Prefer reversible, narrow changes. Treat low-volume weekly movement as a hypothesis unless the intent is clearly irrelevant or the failure is deterministic.

### Advertising guardrails

- Preserve owner-written ad copy, assets, final URLs, bidding strategy, and conversion definitions unless the owner explicitly approves those exact changes.
- Before any Ads mutation, present the exact campaign, old value, new value, keyword or search term, match type, and reason. Obtain explicit approval for the proposed set.
- For budget changes, state the old and new daily budget plus the approximate monthly exposure. Provider identity confirmation remains an owner action; no authentication bypass is acceptable.
- Add a negative only when the query's intent is outside MCSW's supported work. Pause a keyword only when the evidence and intent both justify it. Verify the saved row after every mutation.
- Do not apply Google recommendations merely to increase the optimization score.

### Account and credential guardrails

- Keep secrets inside secure provider or deployment fields. Never print, copy into a report, commit, or return them in tool output.
- Credential rotation, credential revocation, billing changes, public posting, destructive deletion, and account ownership changes require explicit authorization for the named action.
- Retain a rollback credential only until the replacement is proven in production. Revoke the old credential only after confirming no other consumer depends on it.

## Execute the approved pass

1. Fix reliability and measurement defects before interpreting downstream performance.
2. Preserve durable intent before provider calls and keep MCSW's live database and receipt invariants intact.
3. Make focused repository edits with `apply_patch`. Add regression coverage for behavior that could silently return.
4. Run the repository's actual lint, typecheck, regression, and build commands in proportion to risk.
5. Deploy approved code changes and verify the canonical production domain, not only a preview URL.
6. Apply approved dashboard changes in their signed-in account. Re-read the live saved value; a filled dialog is not a completed mutation.
7. Recheck production health, lead acceptance, conversion instrumentation, relevant queues, and changed public routes.
8. Preserve repository changes in a commit. Publishing to a shared branch requires the user's explicit approval unless the repository workflow already supplies that authority.

If an owner-controlled identity or verification gate blocks one action, finish every independent action, leave the exact state staged when safe, and report the single human step required. Never describe the full pass as complete while a gate remains.

## File the weekly scorecard

Copy `assets/weekly-scorecard.md` to `docs/weekly-optimization/YYYY-MM-DD.md` and replace every placeholder. Keep it factual and compact. Do not include customer PII, secrets, private call content, or unverifiable estimates.

The scorecard must account for every material finding as one of:

- applied and production-verified;
- owner-gated with the exact next action;
- intentionally deferred with evidence and a review date;
- monitored with a named success or failure threshold.

## Completion gate

This week's pass is complete only when:

- every audit surface has current evidence or a stated access blocker;
- every applied change is verified in production;
- relevant tests, lint, typecheck, and build checks pass;
- production health and lead acceptance are green;
- external mutations show the intended saved value;
- the scorecard is filed;
- repository state is clean and synchronized when publishing was authorized;
- no owner-gated action remains.

Say **this week's optimization pass is complete**, not that the business is permanently or completely optimized. The next run starts from the filed scorecard and measures what changed.
