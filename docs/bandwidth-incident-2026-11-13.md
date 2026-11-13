# November 13 bandwidth incident: preparation only

The shared Vercel Hobby allowance was consumed primarily by **wr-media: 150.93 GB**, versus **MCSW: 2.70 GB**. The public media deployment includes `wr-customer-walkaround.mp4` (5,346,901 bytes) and `wr-shopcut-92.mp4` (24,789,291 bytes). Project totals do not establish per-file transfer shares. MCSW's cache-first service worker change is a secondary prevention measure; it cannot stop wr-media video delivery or lift the team block.

`scripts/prepare-media-offload.mjs` prints a proposed **wr-media** configuration using an existing base JSON and an explicit external HTTPS origin:

```powershell
node scripts/prepare-media-offload.mjs <base-vercel.json> <https-cdn-origin>
```

It performs no network calls, uploads, overwrites, deletes, billing changes, or deployments. Output is reviewable JSON on stdout. It adds temporary 307 redirects for exactly the two video paths, ahead of existing redirects, preserving their relative order. It retains unrelated configuration, CORS, and the `/api/b` beacon's filesystem routing. It rejects exact redirect collisions and legacy `routes` configurations for separate review. The old MP4 year-long immutable cache header becomes `no-store`; exact redirect paths also receive browser/CDN `no-store` headers so a temporary destination is not pinned for a year. The external CDN can cache the actual versioned video objects separately.

Before any owner-approved deployment:

1. Copy both existing video files to an external provider outside this Vercel team, under the same filenames. Retain originals. Verify bytes or SHA-256 against the source copies.
2. Verify the chosen DNS hostname resolves publicly and actually uses an external provider. Offline URL validation rejects IP literals, local hostnames, Vercel hostnames and known existing business hosts; it cannot prove which provider serves a custom hostname or resolve DNS aliases. Confirm it will not redirect back to this team.
3. Verify each destination returns the correct video and content type, supports byte ranges (`206` for a range request), and has suitable cross-origin video headers. Use HEAD or a small range request before a full playback check.
4. Generate and review the JSON against wr-media's current `vercel.json`, then let the owner approve deployment. This file belongs to wr-media, not MCSW. Deploy only after the destination files are ready and the hosting block is resolved or Vercel allows the change.
5. Read back temporary redirect status, destination, and effective `Cache-Control: no-store` on both original URLs. Confirm `/api/b` still reaches its existing endpoint. Check video playback and subsequent team usage. Keep the original files and base configuration available for rollback.

No external destination is configured or verified by this branch. Restoring service still requires the owner/Philippe hosting decision; this preparation does not change the plan, pause ads, or pay.

Configuration references: [Vercel project configuration](https://vercel.com/docs/project-configuration/vercel-json), [Vercel cache-control headers](https://vercel.com/docs/caching/cache-control-headers).
