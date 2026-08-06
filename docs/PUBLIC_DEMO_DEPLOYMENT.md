# Public demo deployment

This guide covers hosting ApplyReady as a **restricted portfolio demo**. It is **not** a multi-user SaaS product, does **not** create accounts, and is **not** intended for private or sensitive information.

## Modes

| Mode | When | Behavior |
|------|------|----------|
| Local (default) | `PUBLIC_DEMO_MODE` unset/false | Full application: uploads, vault, URL fetch, clear-all, storage paths |
| Public demo | `PUBLIC_DEMO_MODE=true` | Guided Future Engineers Scholarship demo only |

Real uploads, arbitrary URL fetching, vault access, application listing, and global clear-all are disabled in public demo mode.

## Public security model

- Fictional generated documents only
- Real uploads disabled
- Arbitrary URL fetching disabled
- Vault and global clear-all disabled
- No accounts or authenticated private sessions
- Independent concurrent demo sessions identified by cryptographically strong UUIDs (`crypto.randomUUID`)
- Demo IDs are never exposed through a listing endpoint
- Temporary demo data is cleaned up by TTL
- Rate limiting, Helmet, and restrictive CORS apply in production

Knowing a demo UUID is enough to open that fictional temporary session. Treat the public demo as a shared recruiter walkthrough, not private document storage.

## Required environment variables

```env
HOST=0.0.0.0
PORT=8787
PUBLIC_DEMO_MODE=true
NODE_ENV=production
APPLYREADY_DATA_DIR=/tmp/applyready-data
APPLYREADY_UPLOADS_DIR=/tmp/applyready-uploads
APPLYREADY_DB_PATH=/tmp/applyready-data/applyready.sqlite
PUBLIC_DEMO_TTL_HOURS=6
```

Optional:

```env
CORS_ORIGINS=https://your-demo-host.example
TRUST_PROXY=true
PUBLIC_DEMO_CLEANUP_INTERVAL_MS=900000
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=100
DEMO_START_RATE_LIMIT_WINDOW_MS=3600000
DEMO_START_RATE_LIMIT_MAX=10
DEMO_MUTATION_RATE_LIMIT_WINDOW_MS=900000
DEMO_MUTATION_RATE_LIMIT_MAX=120
```

Do **not** set `APPLYREADY_DISABLE_RATE_LIMIT` in hosted environments (that flag is for automated local/E2E testing only).

## Docker

Build:

```bash
docker build -t applyready-public-demo .
```

Run:

```bash
docker run --rm \
  -e PUBLIC_DEMO_MODE=true \
  -e NODE_ENV=production \
  -e HOST=0.0.0.0 \
  -e PORT=8787 \
  -p 8787:8787 \
  applyready-public-demo
```

Health check path: `GET /api/health`

Expected public-demo response:

```json
{
  "ok": true,
  "service": "ApplyReady",
  "mode": "public-demo",
  "time": "..."
}
```

No data directories, upload directories, or database paths are returned in public demo mode.

GitHub Actions builds this image and runs `scripts/ci-public-demo-smoke.mjs` against the container on every pull request and push to `main`.

## Ephemeral storage

Demo metadata and generated PDFs are written under the configured temp directories. On hosts with ephemeral disks (common for free tiers), data disappears on restart. That is expected for this portfolio demo.

Browser refresh on `/demo` restores the current visitor’s in-progress guided demo from session storage when that demo still exists on the server. After a host restart, temporary demos are gone and visitors start a new guided demo.

## Stale-demo cleanup

- Each visitor receives a separate demo application with a cryptographically strong UUID.
- Starting a demo never deletes another visitor’s active demo.
- Applications with `isDemo === true` whose `updatedAt` is older than `PUBLIC_DEMO_TTL_HOURS` (default 6) are deleted opportunistically when a new demo starts, and on a lightweight interval.
- Non-demo applications are never deleted by cleanup.
- Cleanup failures are logged without blocking new demos.
- Invalid `PUBLIC_DEMO_TTL_HOURS` values fall back to the default of 6 hours.

## Client configuration safety

The browser UI loads `/api/config` before rendering navigation. If configuration cannot be loaded, ApplyReady stays locked on a retry screen and does **not** fall back to local-only controls (dashboard, vault, uploads).

## Why uploads are disabled

The hosted surface is a recruiter walkthrough of fictional materials. Accepting real documents on a shared host would require accounts, authenticated ownership, retention policy, and legal review. Public demo mode intentionally refuses uploads and URL ingestion.

## Run the full application locally

```bash
npm ci
npm run db:init
npm run dev
```

Leave `PUBLIC_DEMO_MODE` unset. See the root README for commands and privacy notes.

## Verify a deployment

```bash
npm run build
npm run verify:public-demo
curl -s http://127.0.0.1:8787/api/health
```

Against a running container or host:

```bash
APPLYREADY_SMOKE_BASE_URL=http://127.0.0.1:8787 node scripts/ci-public-demo-smoke.mjs
```

Manual checks:

1. Landing shows the public-demo banner.
2. Guided demo reaches Ready to submit.
3. `POST /api/applications` returns 403 `PUBLIC_DEMO_ONLY`.
4. `GET /api/vault` returns 403.
5. Health JSON has `"mode":"public-demo"` and no filesystem paths.
