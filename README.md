# Music City Specialty Welding

Shop Brain is the operations app and public site for Music City Specialty Welding.

## Stack

- Next.js 16 App Router, React 19, TypeScript, and Tailwind CSS 4.
- Neon Postgres, Vercel Blob, Resend, Web Push, and provider APIs.

## Local development

Use the Node version pinned in `.nvmrc`. Make changes in an isolated Git worktree on a task branch and leave the main checkout untouched. Before installing packages, confirm that `node_modules` belongs to the worktree. Managed task worktrees may link it to the main checkout; do not install through a linked `node_modules`.

Install dependencies with `npm ci`, provide local application configuration in an untracked `.env.local`, then start the app with `npm run dev`. Open `http://localhost:3000`.

## Checks and browser QA

Run the automated checks with:

```sh
npm test
npm run typecheck
npm run lint
```

`npm run test:qa` runs the browser QA suite against a configured target. Its environment variable names are `MCSW_QA_BASE`, `MCSW_QA_LOGIN_URL`, `MCSW_QA_REUSE_AUTH`, `MCSW_QA_JOB_ID`, `MCSW_QA_ACCOUNT_ID`, `MCSW_QA_STRICT`, and `MCSW_BOARD_QA_BASE`. Keep their values in trusted local configuration; do not commit secrets.

## Deployment

Production deployment is triggered by a push to `main`.

## Scheduled work

Vercel Cron runs Gmail sync every 15 minutes and keeps the configured daily jobs. The 15-minute schedule requires Vercel Pro or Enterprise. GitHub Actions back up Gmail sync and run the health monitor, follow-up reminders, morning brief, and weekly database backup.
