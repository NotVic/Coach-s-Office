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
see Settings → "About the estimates" in the app itself. ETA countdowns are
shown only for the skill your club is actually training (synced from CHPP's
`training.xml` when connected, or as reported at CSV import) — untrained
skills say so instead of showing a countdown, dropping skills are flagged as
declining, and the range is age-adjusted using the community's Schum age
factor as a correction on the observed rate.

The trained skill additionally shows a second, independent **modeled**
estimate: the community-reverse-engineered Schum training formula (constants
from Hattrick Organizer's open-source implementation, re-implemented here),
fed by training type, intensity, stamina share, coach skill, and assistant
coach levels (synced via CHPP's `stafflist` when connected, or entered at
CSV import). Between syncs the app keeps decimal sub-skill bookkeeping —
modeled fractional progress toward the next level, recalibrated to zero
whenever CHPP confirms a real level change — and untrained skills past
their age threshold show the modeled natural decay rate. When the observed
and modeled estimates disagree, that's a signal in itself (training slower
than the formula expects → check intensity, coach, or minutes played).
Unknown inputs are assumed conservatively and every assumption is listed on
the estimate.

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

## Or import a CSV instead

Don't have your CHPP keys yet, or just prefer a spreadsheet? Settings has a
CSV import that fills in the dashboard, player detail, and digest the same
way a real sync would (Match Prep still needs a real CHPP connection — it
needs live fixture and opponent data a CSV can't provide). Two input
formats are accepted, auto-detected by header row:

- **A Hattrick players export**, uploaded as-is — recognized by its
  `PlayerID`/`Name`/`Keeper`/`Last match position`-style columns (this is
  the column set Hattrick Organizer and similar CHPP-based tools export;
  see [server/services/csvSchema.js](server/services/csvSchema.js) for the
  exact header names it matches). No editing needed — just upload the file.
- **This app's own simpler template**, downloadable from Settings, for
  hand-typing a squad from scratch — only `first_name` and `tsi` are
  required, everything else (position, skills, specialty...) is optional.

Export (also on the Settings page) always writes the template format —
works after either a CSV import or a real CHPP sync, handy as a backup or
for editing offline before re-importing. Per-player exports don't carry
club finances, so there's an optional "Team finances" section in the
import form (cash/weekly income/weekly expenses, copied from Hattrick's
own Club → Finances page) if you want the net income chart to have
something to show.

**Each import fully replaces the squad** rather than patching it, so a
re-import with only some columns filled in blanks out anything left out —
export first if you want to make small edits rather than retyping
everything. Position and transfer value are derived automatically if left
blank; `player_id` is optional in the template format (a stable ID gets
generated from the player's name so training-ETA history survives
re-imports, as long as the name doesn't change between them) but required
in a Hattrick export, since it's always present there and is what keeps
that history stable and unambiguous. CSV-imported data is superseded, not
merged, the moment you connect via CHPP for real — a real Hattrick team has
a genuinely
different team ID.

## Deploy with Portainer (git-repo stack)

1. In Portainer: **Stacks → Add stack → Repository**.
2. Repository URL: this repo's GitHub URL; Compose path: `docker-compose.yml`.
3. This repo ships a [stack.env](stack.env) with a default `HOST_PORT=3000`
   — Portainer requires a file with that exact name to already exist in the
   repo before its Environment Variables panel reliably applies overrides
   for a **Repository**-type stack, so this is what makes overriding it
   from the Portainer UI actually work (rather than silently doing nothing).
   Only set `HOST_PORT` there — there's no `PORT` variable to set; the
   container's internal port is always 3000 and isn't configurable, only
   the host-side mapping is:
   - `HOST_PORT` — if port 3000 is already taken on your server, set this to
     whatever's free (e.g. `HOST_PORT=3010`).
   - `CHPP_CONSUMER_KEY` / `CHPP_CONSUMER_SECRET` — optional pre-fill.
   - `APP_PASSWORD` — puts the whole app behind HTTP Basic Auth (recommended
     if it's reachable from outside your LAN — it's off by default, which is
     fine for LAN-only access).
4. Deploy. Portainer builds the image from the `Dockerfile` in this repo
   and starts it, with a named volume for the database so data survives
   restarts/redeploys.
5. Open `http://<your-server>:<HOST_PORT or 3000>` and finish the connect
   flow above. If the container has no published port afterward, see
   Troubleshooting below.

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
- **Container has no published port after deploying in Portainer** — check,
  in order:
  1. The container's own detail/inspect page in Portainer (not just the
     summary column in the Containers list, which can be misleading) — and
     try actually browsing to the port before assuming it's wrong.
  2. The container's logs for "port is already allocated" — this means
     `HOST_PORT` didn't take effect and Docker fell back to the default of
     3000, which is already in use on your server. A typo'd variable name
     (it must be exactly `HOST_PORT`) is the easy way to cause this.
  3. Whether [stack.env](stack.env) is present in the repo you deployed
     from. For **Repository**-type stacks specifically, Portainer needs
     this file to already exist in the repo for its Environment Variables
     panel to reliably apply your overrides — without it, values typed
     into that panel may not reach the container at all, silently. If
     you're on a fork or an older clone that predates this file, pull the
     latest commit and redeploy.

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
