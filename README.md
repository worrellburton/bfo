# Welcome to React Router!

A modern, production-ready template for building full-stack React applications using React Router.

[![Open in StackBlitz](https://developer.stackblitz.com/img/open_in_stackblitz.svg)](https://stackblitz.com/github/remix-run/react-router-templates/tree/main/default)

## Features

- 🚀 Server-side rendering
- ⚡️ Hot Module Replacement (HMR)
- 📦 Asset bundling and optimization
- 🔄 Data loading and mutations
- 🔒 TypeScript by default
- 🎉 TailwindCSS for styling
- 📖 [React Router docs](https://reactrouter.com/)

## Getting Started

### Installation

Install the dependencies:

```bash
npm install
```

### Development

Start the development server with HMR:

```bash
npm run dev
```

Your application will be available at `http://localhost:5173`.

Note that `npm run dev` serves the SPA only — the `/api/*` serverless functions
(sign-in, Plaid, Mercury, documents) need `vercel dev` or a deployment.

## Environment

Set these in the Vercel project:

| Variable | Used for |
| --- | --- |
| `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` | everything stored: users, sessions, sign-in codes, Plaid tokens, Books, mail, and the entity tree (entities, documents, estate map, notes, agents) with its files |
| `BIRD_ACCESS_KEY` | Bird API access key (sent as `Authorization: AccessKey …`) |
| `BIRD_WORKSPACE_ID` | Bird workspace the channels live in |
| `BIRD_SMS_CHANNEL_ID` | *optional* — pins the SMS channel; otherwise the workspace's SMS channel is discovered automatically |
| `BIRD_EMAIL_CHANNEL_ID` | *optional* — same, for email |
| `AUTH_SECRET` | *optional* — pepper mixed into the hash of each one-time code |
| `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV` | bank links on `/treasury`, brokerage links on `/investments` |
| `PLAID_REDIRECT_URI` | *optional* — required for Production OAuth banks; must match an Allowed redirect URI in the Plaid dashboard |
| `ANTHROPIC_API_KEY` | reading, filing and verifying entity documents |
| `CRON_SECRET` | authenticates the scheduled Books sync and Treasury report |
| `BIRD_WEBHOOK_SECRET` | *optional* — signing secret of the Bird webhook that delivers new mail to `/api/mail-webhook`; without it, the inbox fetches new mail when it checks |
| `MAIL_DOMAIN` | *optional* — the domain inboxes live on (default `burtonfamilyoffice.com`) |
| `PALM_API_KEY` | Palm (getpalm.com): the state's record of each entity, Palm as registered agent, and forming new entities. A `sk_test_…` key files nothing with any state; `sk_live_…` does |
| `OPENAI_API_KEY` | drawing the logo reference sheet on Settings (gpt-image): six "Burton Family Office / BFO" lockups, each in a typeface the site can set |
| `MESHY_API_KEY` | turning the chosen logo into a 3D model (Meshy image-to-3D) |
| `PALM_WEBHOOK_SECRET` | *optional* — signing secret of the Palm webhook at `/api/palm-webhook` (agent mail, filing progress) |

### The entity tree

Entities, their documents and contracts, the estate map, notes and office
agents are one JSON tree in Supabase (`tree_nodes`, one row per entity /
note / … with the record as JSON; `supabase/migrations/20261017_tree_nodes.sql`).
The browser reads and writes it through `/api/tree`, which keeps the small
Firebase-style surface the pages were written against (`app/store.ts`:
`ref`, `get`, `onValue`, `update`, `set`, `push`, `remove`). Other people's
changes arrive by polling every 30 s while the tab is visible.

This replaced Firebase. The first time a collection is asked for after
deploying, the server copies it out of the old Firebase Realtime Database
(`tree_imports` records that it happened); files kept in Firebase Storage are
moved into the private `documents` bucket as their entities are opened
(`lib/firebase-bridge.ts`). When every row of `tree_imports` is `done` with
`files_done` set, Firebase is no longer read and the project can be deleted.

### Sign-in

`/login` takes a phone number, sends a 6-digit code through
Bird, and exchanges it for a 30-day session stored in `app_sessions`. Anyone who
verifies a code lands in `app_users` as `incoming` — an owner or admin approves
them from `/users` before they can get in. Roles are `owner`, `admin`, `member`,
`viewer` and `email` ("Email only": their own inbox and nothing else); owners and
admins can manage users.

### The 3D logo

Settings has a logo studio for owners and admins. "Draw the style sheet" asks
OpenAI for six takes on a "BFO" mark, each rendered as one physical object on a
plain backdrop so it scans well (Monolith, Liquid chrome, Aurora glass, Signet,
Three faces, Inline serif; "Adjust" adds a note before a redraw). "Make it 3D"
sends the picture to Meshy, which returns a textured GLB in a few minutes; the
model and its poster are copied into the public `brand` bucket (Meshy's links
expire) and shown in the card. "Use on site" puts it on the landing page (where
it turns and can be dragged) and in the app's corner; "Back to the wordmark"
undoes it. State lives in `brand_settings`; `/api/brand` serves the current
logo to anyone and the studio to admins.

### The operating agreement's execution page

The drafted agreement ends with a signature page built for signing: one
full-width block per signer with their capacity and share, a clear space above
each line for a pen or an e-signature stamp, and the lines a signer expects. A
company member signs "By:" an authorized signature with printed name, title and
date; a person signs with signature and date, their name already printed.
Blocks that don't fit flow to another signature page. Exhibit A follows.

### Reading documents

A stored PDF or picture opens in BFO's own reader (a full-screen page with
Back, Download and New tab) rather than in the browser's viewer at a storage
URL: pages are drawn with pdf.js, continuous and fitted to the width, with the
page count as you scroll. A modifier or middle click still opens the signed
link in a new tab, as do file types the reader doesn't show. Paperwork BFO
drafted itself (the operating agreement, the W-9) can be drafted again from
the filled slot, so a draft made before a layout change can be refreshed; the
earlier file stays in Documents.

### Palm cases

When Palm can't finish something (a registered agent change, a formation)
without information only you have, it opens a *case* listing what it needs and
sends a `case.opened` webhook; owners and admins get an email and the activity
log notes it. The entity page shows the case with a form built from Palm's own
field list: on the Formation card for an entity BFO formed, and under "Palm
needs" on the Compliance tab for any entity linked to Palm. Address fields are
prefilled from the entity's principal or mailing address, split the way Palm
takes them. "Send to Palm" posts the answer to Palm's case API; the case shows
as answered until Palm resolves it. Only owners and admins can answer.

Palm posts webhooks to `https://www.burtonfamilyoffice.com/api/palm-webhook`
(use the www host: the bare domain answers every request, `/api` included,
with a 308 to www, and Palm doesn't follow redirects, so a webhook pointed at
the bare domain fails silently and Palm disables it after ten failures). Tools
→ Entity compliance → Palm costs shows when the last webhook arrived. Events
are stored by id, so a batch Palm resends is taken once. `vercel.json` carries
a host-conditioned redirect for everything but `/api`, so once the apex
domain's redirect is turned off in Vercel (Project → Domains), pages still
canonicalize to www while webhooks hitting the bare domain are served.

### Forming an entity

"New entity" on `/assets` records an entity that already exists, or hands off to
a wizard that forms a new LLC or corporation through Palm: the name is checked
against the state as it's typed (with alternatives when it's taken), then
addresses and contact, the people (organizers or incorporators, and optionally
members/managers or directors/officers), Palm's services (Palm as registered
agent or your own; an EIN application, whose responsible-party SSN goes straight
to Palm and is never stored), whatever else the state asks for (from Palm's
requirement schema), and a review with the state's fee, processing speed and
Palm's own validation. Nothing is filed until the final confirmation, which
spells out the state and the cost; in live mode it also asks you to type the
entity's name, since a filing with the state can't be undone. In test mode the
confirmation says so and the entity is created here as a test.

The operating agreement is not part of the filing: states form an LLC from the
articles alone, and Palm's formation request has no field for one. Draft it
after formation and keep it on the entity's Documents tab.

Submitting creates the entity (status "Forming") with the filing under
`palm.<mode>.formation`. Palm's `filing.*` webhooks and a poll every 30 seconds
while the page is open move it along (queued → ready to file → processing →
filed → formed); on completion the file number, formation date, registered agent
and, once issued, the EIN land on the record. Only owners and admins can submit.

### Mail

Every user has an address on the family domain (assigned from their first name;
admins can change it on `/users`) and a Mail page at `/inbox`. Bird receives the
mail and BFO keeps each mailbox's copy in Supabase (`mail_messages`, attachments
in the private `mail` bucket; `read_at` and `starred_at` mark unread and starred).
On a phone, Mail is its own place: the app's bar and menu stay out of it, a
"BFO" link at the top leads back, and the mailbox is the title, a large
dropdown with its own colour and the unread count, so it's always clear whose
mail is on screen; its menu rises as a glass sheet listing every address.
Behind the list a WebGL aurora drifts in the mailbox's hue, brightens as you
scroll and blooms where you touch (one still frame under reduced motion). Mail
has its own light/dark setting, light unless switched: the appearance button
in the corner (a moon in the light, a sun in the dark) flips it, the device
remembers it, and it applies only while Mail is on screen; the rest of the
app keeps its own theme. Rows
arrive one after another under day separators; a star pops. Moving between the
list and a message is a view transition (`app/view-transition.ts`, on the viewport's snapshot, no blur, so a phone keeps up): one page
slides out as the other slides in (and back the other way), a loader stays
long enough for its scene to play through (the constellation assembling, the
envelope opening) and then fades into what it was waiting for, a cached
message opens at once, and transitions queue rather than cut each other
short, so each plays to its end; the aurora and the round Compose
button in the corner stay put. A row swiped left archives (with Undo), swiped right stars; a held
finger picks it for a bulk action; pulling the list down asks Bird for new
mail (`app/mail-pull.tsx`: the list rides the finger, a ring fills, spins, then
draws a check and says "3 new" or "Up to date", and the aurora brightens with
the pull), and a "New mail" pill offers mail that arrived since the list was
read. The
title shrinks into a glass bar as the list scrolls, a thin line across the top
shows how far through a message you are, unread senders' pictures carry the
mailbox's light, and an empty folder gets a quiet card. Attachments show as
icons by kind (`lib/file-kind.ts`, `app/file-icon.tsx`): a red PDF page, a
photo, a spreadsheet, a document, slides, an archive, audio, video, an invite,
code, and each mark moves a little. Snippets leave out a
help desk's wrapping ("type your reply above this line", footers, ticket codes). On larger screens, one control under the page title says whose mail is
shown: "All mailboxes" or one address; its menu lists every address on the
account with a copy on each, and admins add and remove extras there. Compose's
From line is the same kind of dropdown. Mail to an address nobody has
lands in "Other", which owners and admins see. Pictures in a message are
served through `/api/mail-image`: the server rewrites each remote image to a
signed BFO address and fetches it on the reader's behalf, so a phone's browser
or content blocker has no third-party image to refuse inside the sandboxed
frame, and a sender's tracking pixel sees BFO's server rather than the reader.
Images show by default; "Hide images" holds them back for a message. Mail
laid out wider than the screen (a fixed 600px table) is scaled down to fit the
frame's width, the way a phone's mail app does, and refits when the phone turns;
the frame's document opts out of iOS Safari's text inflation so the scaled
layout keeps the sender's type sizes.
Each wait has its own scene rather than a skeleton, drawn in the mailbox's
colour (`app/mail-loaders.tsx`): while the list loads, hundreds of points of
light stream down and settle into the shape of the rows, a pulse runs down them
and envelopes glide in to land on the rows; a search is a sonar sweep over a
field of mail, lighting each message the beam passes and pinging the ones that
match; a message opening is a letter sliding out of its envelope as the ink
arrives; Send shows a spark circling, then a paper plane darting off and a
check in its place; Improve design, an uploading file and the pull-to-refresh
ring use the same spark. Under reduced motion each scene is one still frame.
Each folder can be narrowed to unread or starred mail, and shown either as a
table (sender, subject, summary, attachment, time) or as a list beside the open
message. On a phone the folder row is one control that shows only what's
chosen ("Active", "Starred", or "In · Unread" with its count); tapping it opens
a glass menu of cards: Active across the top, then In, Out, Archive and a gold
Starred (a place of its own there, every starred conversation), with an All
mail / Unread only switch underneath. Other stays a desktop tab.

To set it up in Bird:

1. Email → Domains → burtonfamilyoffice.com: turn on **Receiving** (the MX
   records already point at Bird).
2. Developers → API keys: let the `BIRD_ACCESS_KEY` key read received mail.
3. Optional, for instant delivery: add a webhook to
   `https://www.burtonfamilyoffice.com/api/mail-webhook` (the www host; the bare domain redirects, and webhooks don't follow redirects) for `email.received`, and
   save its signing secret as `BIRD_WEBHOOK_SECRET`.

## Building for Production

Create a production build:

```bash
npm run build
```

## Deployment

### Docker Deployment

To build and run using Docker:

```bash
docker build -t my-app .

# Run the container
docker run -p 3000:3000 my-app
```

The containerized application can be deployed to any platform that supports Docker, including:

- AWS ECS
- Google Cloud Run
- Azure Container Apps
- Digital Ocean App Platform
- Fly.io
- Railway

### DIY Deployment

If you're familiar with deploying Node applications, the built-in app server is production-ready.

Make sure to deploy the output of `npm run build`

```
├── package.json
├── package-lock.json (or pnpm-lock.yaml, or bun.lockb)
├── build/
│   ├── client/    # Static assets
│   └── server/    # Server-side code
```

## Styling

This template comes with [Tailwind CSS](https://tailwindcss.com/) already configured for a simple default starting experience. You can use whatever CSS framework you prefer.

---

Built with ❤️ using React Router.
