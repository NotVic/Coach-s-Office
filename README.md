# Coach's Office

A self-hosted companion dashboard for [Hattrick](https://www.hattrick.org) —
the browser football manager game. It reads your squad via Hattrick's CHPP
API and helps you answer the three questions a manager checks every week:

1. **How is my squad doing, overall?** — Team TSI & Worth over time, age
   distribution, squad composition by position line.
2. **What's happening with this player?** — skills with a training ETA,
   transfer value trend, TSI history.
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
3. Add environment variables in Portainer's stack UI if you want to
   pre-fill `CHPP_CONSUMER_KEY`/`CHPP_CONSUMER_SECRET`, or set
   `APP_PASSWORD` to put the whole app behind HTTP Basic Auth (recommended
   if it's reachable from outside your LAN — it's off by default, which is
   fine for LAN-only access).
4. Deploy. Portainer builds the image from the `Dockerfile` in this repo
   and starts it on port 3000, with a named volume for the database so data
   survives restarts/redeploys.
5. Open `http://<your-server>:3000` and finish the connect flow above.

To update after pulling new commits: redeploy the stack in Portainer (or
pull + `docker compose up -d --build` directly on the server).

## Environment variables

See [.env.example](.env.example) for the full list — `PORT`, `DATA_DIR`,
`APP_PASSWORD` (optional shared-password gate), and `CHPP_CONSUMER_KEY` /
`CHPP_CONSUMER_SECRET` (optional pre-fill; can also be entered in Settings).

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

## What's not in v1

Deferred as a roadmap: weekly net income as a standalone chart, a
persistent "needs attention" panel, contract/wage countdowns (Hattrick's
contract model needs more research — see the note on `players.contract_expiry`
in `server/db.js`), a side-by-side player compare, injury/suspension
history, and email/push notifications for the digest (it's in-app only for
now, at `/digest.html`).

## Project layout

```
server/    Express app, CHPP OAuth client + XML parsing, sync/scheduler/training/valuation services
public/    Static frontend (vanilla JS, one page per route)
```
