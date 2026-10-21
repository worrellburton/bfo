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
| `OPENAI_API_KEY` | drawing the logo style sheet on Settings (gpt-image) |
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

### Palm cases

When Palm can't finish something (a registered agent change, a formation)
without information only you have, it opens a *case* listing what it needs and
sends a `case.opened` webhook; owners and admins get an email. The entity's
Compliance tab shows the case under "Palm needs" with a form built from Palm's
own field list. Address fields are prefilled from the entity's principal
address (the mailing address follows it until unticked). "Send to Palm" posts
the answer to Palm's case API; the case shows as "Palm is on it" until Palm
resolves it. Only owners and admins can answer.

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
Mail to an address nobody has lands in "Other", which owners and admins see.
Each folder can be narrowed to unread or starred mail, and shown either as a
table (sender, subject, summary, attachment, time) or as a list beside the open
message.

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
