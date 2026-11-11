# Chat live evaluation — November 11, 2026

R2-1: **NOT RUN — no local model credential is available.**

The November 10, 2026 local check found no nonempty `ANTHROPIC_API_KEY`,
`AI_GATEWAY_API_KEY`, `VERCEL_OIDC_TOKEN`, or `OPENAI_API_KEY` in the process
environment. There are no local `.env*` files in this worktree root or the base
repository root. The check reported presence only; no environment value was
printed. No credential was fetched, and `vercel env pull` was not run.

`npm run test:ai-evals` resolves to `scripts/ai-evals.test.mjs`. Its live model
test requires `MCSW_RUN_AI_EVALS=1` and a gateway credential; ordinary test runs
exercise synthetic extraction fixtures and skip the model. The opt-in
extraction test calls only the model SDK and does not import the shop database,
handoff, Resend, SMS, or inbox delivery modules. It would not by itself prove
customer-chat quality: that needs the real assistant turn with 25 or more
paraphrased questions and its actual provider replies.

No live model evaluation or live-chat transcript was fabricated. There were no
customer messages, shop-inbox messages, SMS, Resend sends, or production database
writes. The requested delivery readback (13e) was not performed.

Offline regression evidence covers the twelve Fable answer cases, the retained
gate electrical and mobile-fit caveats, the next intake question after sourced
answers, yes/no openings, shop voice, configured phone wiring, and existing
safety boundaries. These deterministic tests are not a substitute for the
missing live paraphrase transcript; R2-1 remains open.
