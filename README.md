# Coach's Office

A self-hosted companion dashboard for [Hattrick](https://www.hattrick.org) —
the browser football manager game. It reads your squad via Hattrick's CHPP
API and helps you answer the three questions a manager checks every week:

1. **How is my squad doing, overall?** — Team TSI & Worth over time, age
   distribution, squad composition by position line, weekly net income, and
   a persistent "needs attention" panel (injuries, recent level-ups,
   players whose value estimate just started falling).
2. **What's happening with this player?** — skills with a training ETA,
   transfer value trend, TSI history, recent match ratings, and wage shown
   in context against your team's income.
3. **What should I do next?** — next-match prep (opponent snapshot, a
   suggested XI, availability) and a weekly digest of what actually changed.

It's a companion, not a replacement for hattrick.org — read-only in v1, no
lineup or training-order changes.

**On estimates:** Hattrick doesn't publish its training-speed or
transfer-value formulas, and CHPP doesn't expose a player's fractional
progress toward their next skill level. So training ETAs here are modeled
from *this app's own tracked history* (not Hattrick's internal math), and
transfer value is a transparent, order-of-magnitude estimate from TSI and
age. Both always render as a `~` range, never a confident single number —
see Settings → "About the estimates" in the app itself.

## Stack

Node.js + Express, vanilla JS/HTML/CSS on the frontend (no build step),
SQLite via Node's built-in `node:sqlite` for storage — no native module to
compile, no external services required. Everything runs in one container.

## Run locally

Requires Node 22.5+ (for `node:sqlite`).

```bash
npm install
cp .env.example .env      # then fill in what you want pre-filled
npm run dev                # http://localhost:3000
```

The SQLite database is created under `./data/` (gitignored).

## Connect your Hattrick account

1. Register a CHPP application at
   [hattrick.org/en/Chpp](https://www.hattrick.org/en/Chpp/) to get a
   **consumer key** and **consumer secret**. Any redirect/callback URL field
   in that form can be left blank or set to anything — this app uses CHPP's
   out-of-band OAuth flow (Hattrick shows you a verification code on its own
   site, there's no callback URL involved).
2. Start the app and open **Settings**.
3. Paste in the consumer key/secret, then click **Connect to Hattrick** —
   it opens Hattrick's authorization page in a new tab.
4. Approve access there, copy the verification code Hattrick shows you, and
   paste it back into the Settings page to finish connecting.
5. Set your sync schedule (Hattrick's weekly processing time depends on
   your league's country bloc — e.g. Belgium is training ~Friday 07:00,
   match results ~Sunday 16:00 — set your own). A manual **Sync now** on the
   Dashboard is always available too.

Your tokens are stored only in the local SQLite database (`./data/` — see
`.gitignore`, never commit that directory or a `.env` file).

## Deploy with Portainer (git-repo stack)

1. In Portainer: **Stacks → Add stack → Repository**.
2. Repository URL: this repo's GitHub URL; Compose path: `docker-compose.yml`.
3. Add environment variables in Portainer's stack UI as needed:
   - `HOST_PORT` — if port 3000 is already taken on your server, set this to
     whatever's free (e.g. `HOST_PORT=3010`). The container's internal port
     always stays 3000; only the host-side mapping changes.
   - `CHPP_CONSUMER_KEY` / `CHPP_CONSUMER_SECRET` — optional pre-fill.
   - `APP_PASSWORD` — puts the whole app behind HTTP Basic Auth (recommended
     if it's reachable from outside your LAN — it's off by default, which is
     fine for LAN-only access).
4. Deploy. Portainer builds the image from the `Dockerfile` in this repo
   and starts it, with a named volume for the database so data survives
   restarts/redeploys.
5. Open `http://<your-server>:<HOST_PORT or 3000>` and finish the connect
   flow above.

To update after pulling new commits: redeploy the stack in Portainer (or
pull + `docker compose up -d --build` directly on the server).

## Environment variables

See [.env.example](.env.example) for the full list — `PORT` (app-internal,
only relevant when running outside Docker), `HOST_PORT` (docker-compose
only — which host port maps to the container, in case 3000 is taken),
`DATA_DIR`, `APP_PASSWORD` (optional shared-password gate), and
`CHPP_CONSUMER_KEY` / `CHPP_CONSUMER_SECRET` (optional pre-fill; can also be
entered in Settings).

## Troubleshooting

- **A sync fails with a CHPP error mentioning file/version** — Hattrick
  occasionally bumps CHPP file versions. Check
  [chpp.hattrick.org](https://chpp.hattrick.org) for the current version of
  the affected file and update the version string in
  [server/services/sync.js](server/services/sync.js)'s `FILE_VERSIONS`
  (or `server/services/matchPrep.js` for the `matches` file version).
- **"Opponent squad TSI unavailable" on Match Prep** — CHPP restricts full
  player-list access for teams other than your own in some cases; the app
  degrades gracefully and skips the win/draw/loss estimate rather than
  fabricate one.
- **Training ETA says "not enough history yet"** — that's expected for the
  first sync or two. ETAs are derived from snapshots this app has actually
  collected since you connected, not from Hattrick directly (see "On
  estimates" above).
- **Container has no published port after deploying in Portainer** — almost
  always means `HOST_PORT` wasn't actually picked up (a typo'd variable
  name is an easy one — it must be exactly `HOST_PORT`), so Docker fell
  back to the default of 3000. If 3000 is already taken on your server,
  the container fails to start rather than publishing on a fallback port.
  Check the container's logs in Portainer for "port is already allocated"
  to confirm, fix the variable name/value in the stack's environment
  variables, and redeploy.

## What's not in v1

- **Hattrick players don't have contracts** (only staff do — players are
  owned indefinitely until sold, fired, or retired to the Hall of Fame), so
  there's no "contract expiring" feature here and there never will be one —
  it was on the original feature backlog but doesn't correspond to a real
  game mechanic. Wages are shown in context (against your team's weekly
  income) instead.
- **Plan training changes ahead of time** stays deferred — it needs CHPP
  write access, and this app is deliberately read-only in v1 (no lineup or
  training-order changes).
- Still deferred as a roadmap: a side-by-side player compare,
  injury/suspension history, and email/push notifications for the digest
  (it's in-app only for now, at `/digest.html`).

## Project layout

```
server/    Express app, CHPP OAuth client + XML parsing, sync/scheduler/training/valuation services
public/    Static frontend (vanilla JS, one page per route)
```
