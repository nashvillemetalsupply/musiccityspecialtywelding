# Ops legacy archive — 2026-08-20

Retired by conversion task C7 (layout flip, `/board` front door). These are
disabled reference copies only — the `.txt` suffix keeps them out of the
TypeScript and CSS builds. Do not import or re-enable them; the live `/ops`
shell now speaks the board language from `styles/control.css` +
`app/ops/ops-shell.css`.

| Archive file | Original path |
|---|---|
| `jobs.css.txt` | `app/ops/jobs.css` |
| `jobs-brand.css.txt` | `app/ops/jobs-brand.css` |
| `weighted-job-index.tsx.txt` | `app/ops/weighted-job-index.tsx` |
| `active-job-index.tsx.txt` | `app/ops/active-job-index.tsx` |
| `active-job-controls.tsx.txt` | `app/ops/active-job-controls.tsx` |

`active-job-controls.tsx.txt` joined them later, under C8 finding F8. It was the
stage-filter and search bar for the two indexes above, and it survived C7 only
because they imported it rather than the page. Once they were archived nothing in
`app/`, `components/` or `lib/` imported it, and its job — filter by stage, search,
page — is done live by the board's own search and stage controls
(`app/board/board.tsx`). Its `boardHref()` still builds `/ops?stage=…#active-jobs`
links, which no longer resolve, so it is reference only: the two archived indexes
here import it and would not read whole without it.

Contents are byte-identical to the files as they stood when retired
(content-preserving `git mv`; full history remains in git).
