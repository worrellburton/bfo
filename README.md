# BFO

BFO is the Burton family office's private web app: one place for the family's
entities (LLCs, corporations, trusts), their documents and compliance, bank and
brokerage balances (Treasury), bookkeeping (Books), everyone's mail on the
family domain, paper mail from the Phoenix mailbox, texts to and from the office
number, and an assistant ("Ask BFO") that answers from those records. It is also an
iPhone and iPad app that wraps the live site.

## Stack

A React Router 7 single-page app (`app/`, SSR off, Vite, Tailwind v4,
TypeScript) served as static files from Vercel, with Vercel serverless
functions under `api/` for everything that needs a secret or a database.
Shared server code lives in `lib/`. Data is Supabase Postgres, reached over
PostgREST with the service key through `sb()` in `lib/auth.ts` (no ORM). Files live in private
Supabase Storage buckets (`documents`, `mail`, `receipts`; `brand` is public).
Integrations: Plaid (banks, brokerages), Mercury (bank history), Palm (state
registries, registered agent, formations), Bird (SMS codes, email in and out,
texts in and out), Stable (paper mail), Apple APNs (push), OpenAI (voice and the
logo studio), Anthropic (Ask BFO and document reading), Meshy (3D logo), and
a one-way bridge out of the old Firebase project. The iOS shell is Capacitor
(`ios/`, `capacitor.config.ts`).

## Run it locally

```bash
npm install
npm run dev        # the SPA at http://localhost:5173
```

`npm run dev` serves only the SPA. Every `/api/*` function needs the Vercel
runtime: run `vercel dev` (Vercel CLI, linked to the project) with the
variables below in `.env` or pulled with `vercel env pull`. Without the API you
can look at the public pages and the sign-in screen, nothing more.

### Environment variables

Set these on the Vercel project (Production, and Preview if you use it).
Optional ones are marked. Never commit values.

| Variable | Meaning |
| --- | --- |
| `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` | The Supabase project and its service-role key. Every read and write goes through them. |
| `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF` | Only for `npm run migrate` (never on Vercel): a personal access token and the project ref. |
| `AUTH_SECRET` | optional. Pepper for hashed codes; also the fallback signing key for mail image links. |
| `SIGNIN_COUNTRY_CODES` | optional. Comma list of country codes that may receive sign-in texts (default `+1`; `*` = any). |
| `SIGNIN_HOURLY_CAP` | optional. Sign-in codes sent to everyone per hour (default 60). |
| `BIRD_ACCESS_KEY` | Bird API key (`bk_<region>_…`). Sends codes, email, reads inbound mail. |
| `BIRD_WORKSPACE_ID` | optional. Bird workspace UUID; discovered from the key when unset. |
| `BIRD_SMS_CHANNEL_ID`, `BIRD_EMAIL_CHANNEL_ID` | optional. Pin a channel instead of discovering it. |
| `BIRD_SMS_FROM` | optional. The number texts are sent from (and texts arrive on). Replies from the Phone page need its toll-free verification approved in Bird. |
| `BIRD_EMAIL_FROM`, `BIRD_EMAIL_REPLY_TO` | optional. Sender for system email (default `BFO <reports@burtonfamilyoffice.com>`). |
| `BIRD_WEBHOOK_SECRET` | optional. Signing secret of the Bird webhook at `/api/mail-webhook` (events `email.received`, `sms.received`, and `sms.sent`, `sms.delivered`, `sms.undelivered`, `sms.failed`, `sms.rejected`, `sms.expired` for sent texts' status). Without it, mail arrives by polling only, and texts not at all. |
| `MAIL_DOMAIN` | optional. The mail domain (default `burtonfamilyoffice.com`). |
| `MAIL_IMAGE_SECRET` | optional. Signs proxied image URLs in mail (falls back to `AUTH_SECRET`, then the service key). |
| `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV` | Plaid credentials; `PLAID_ENV` names a key of the SDK's `PlaidEnvironments` (`sandbox` by default, `production` live). |
| `PLAID_REDIRECT_URI` | optional. Needed for OAuth banks in production; must match the Plaid dashboard. |
| `MERCURY_API_TOKEN` | optional. Mercury's own API, for history older than Plaid serves. |
| `REPORT_ACTIVITY_MASK` | optional. Account last-fours whose activity rides in the Treasury report (default `1886,1116`). |
| `CRON_SECRET` | Vercel sends `Authorization: Bearer $CRON_SECRET` on cron fires; without it every cron is refused. |
| `PALM_API_KEY` | Palm key. `sk_test_…` files nothing and bills nothing; `sk_live_…` files with states and is billed. |
| `PALM_WEBHOOK_SECRET` | optional. Signing secret of the Palm webhook at `/api/palm-webhook`. |
| `STABLE_API_KEY` | Stable (paper mail) API key. |
| `STABLE_WEBHOOK_TOKEN` | Shared token in the Stable webhook URL (`/api/stable-webhook?token=…`). |
| `ANTHROPIC_API_KEY` | Ask BFO, document classification, profile and verification, document renaming. |
| `OPENAI_API_KEY` | Voice (transcription, speech, Realtime) and the logo reference sheet. |
| `MESHY_API_KEY` | optional. Image-to-3D for the logo studio and the signing game's props (the game studio, or `npm run game:props`). |
| `ELEVENLABS_API_KEY` | optional. Judy's voice and the sound effects for the signing game (the game studio, or `npm run game:judy` and `game:sounds`). |
| `GAME_JOB_TOKEN` | optional. A token minted for a Claude session so it can run the game studio (`api/game-assets.ts`) from outside with the keys staying on Vercel; delete it to revoke. |
| `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_KEY_P8` | Apple push key for the iPhone app. `APNS_BUNDLE_ID` optional (default `com.burtonfamilyoffice.app`). |
| `SITE_URL` | optional. Site origin used in emails (default `https://www.burtonfamilyoffice.com`). |

## The signing games

A signature request can go out in "Anything Is Possible" mode (Tools ›
Signatures › How they sign) or as the racetrack game, but only one of
TallulahMD LLC's: no other entity's request offers the choice, and the
server refuses it (`lib/game-entity.ts`). A reminder, or a send, can go out
"as a normal request" (a box beside Remind, or in the resend dialog): the
email says nothing about the game, and the link still opens it. A finished
request can be sent again ("Resend for signature" on its page): a new
request with the same document and parties, an Address box under each
signature so the signer types their address this time (`fields` of type
`address`, stamped on the document with the signature), in the theater, the
racetrack, or the plain page. The racetrack (`app/sign/kart`): Sam races
Judy, two laps of about a minute, while she rams him; on the final stretch
her kart flips, her arm comes off, Sam finds it on foot and tapes it back,
and she drives over the line laughing. Her lines are by cue in
`public/kart/judy.json`; the race's song and the last-lap track were made
with ElevenLabs Music (see `public/kart/README.md`). "Games" in
Robert's menu (`/games`) lists both with a Play button each
(`/sign/preview`, `/sign/preview?game=race`).

In "Anything Is Possible" mode the signer's link opens a first-person game
in front of the signing page: a floating island, a chain of blocks to the
theater on the next island, the seat with their name on it, the film, and the
door to the room with the contract. The game is `app/sign/game` (three.js,
loaded only on that page); its movie, music, sound effects and optional GLB
props live in `public/game` and are named in `public/game/manifest.json`
(see `public/game/README.md`). Play, on the Games page, runs the whole
thing on a sample document and signs nothing (`/sign/preview`); its "Game
studio" panel makes Judy's voice, the
sound effects and the props on the server (`api/game-assets.ts`, with the
keys Vercel holds) and stores them in the public brand bucket, where they
win over the static manifest. A cron (`api/cron/game-assets.ts`, every five
minutes) fills in whatever is missing on its own and works a request list in
`brand_settings` ("game-assets-requests") for redoing Judy with another
voice, a sound, or a prop with a new prompt.

## Check, test, build

```bash
npm run typecheck      # react-router typegen, then tsc
npm run lint           # eslint
npm run format         # prettier --write (format:check only reports)
npm test               # vitest run (tests/*.test.ts and lib/*.test.ts)
npm run test:coverage  # the same with coverage; fails under the floor in vite.config.ts
npm run audit          # known vulnerabilities in what ships
npm run e2e            # the app in Chromium against a running build (e2e/run.cjs)
npm run build          # react-router build → build/client
npm run migrate        # apply pending supabase/migrations (see the runbook)
```

Node 22 (`.nvmrc`; `engines` in package.json). CI (`.github/workflows/ci.yml`)
runs typecheck, lint, the format check, the tests with their coverage floor, the
production audit, the build, and the browser checks on every push and pull
request to `main`; `deploy-check.yml` then waits for production to pick up a
merged commit and checks it answers. Dependabot opens weekly update PRs. Tests
are pure-function tests plus mocked `sb()`; none touches a network. Copy
`.env.example` to `.env` for `vercel dev`.

## Deploy

Vercel builds `main` on every push (`vercel.json`: `npm run build`, output
`build/client`, functions from `api/**/*.ts`). There is no manual deploy step.
Pull requests get preview deployments. Crons, function memory and timeouts,
redirects and headers are all in `vercel.json`.

The iPhone app opens the live site, so a web deploy reaches it at once. Only
changes to `ios/`, `capacitor.config.ts` or the Capacitor plugins need a new
build, which the "iOS → TestFlight" GitHub Action makes (see the runbook).

## Where to look next

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): how a request flows, auth and
  roles, the JSON tree, mail, Books, entities, push, Ask BFO, directory map.
- [docs/RUNBOOK.md](docs/RUNBOOK.md): each integration, its env vars and
  dashboard, key rotation, failure modes and log lines, crons, migrations,
  shipping an iOS build.
- [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md): branches, commits, code style,
  how to add a route, an endpoint, a migration, a test.
- [docs/ios-app.md](docs/ios-app.md): App Store Connect setup, listing,
  privacy answers.
- [CLAUDE.md](CLAUDE.md): the short version for tools and new contributors.
