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
| `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` | users, sessions, sign-in codes, Plaid tokens, Books, entity documents |
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

### Sign-in

`/login` takes a phone number, sends a 6-digit code through
Bird, and exchanges it for a 30-day session stored in `app_sessions`. Anyone who
verifies a code lands in `app_users` as `incoming` — an owner or admin approves
them from `/users` before they can get in. Roles are `owner`, `admin`, `member`,
`viewer` and `email` ("Email only": their own inbox and nothing else); owners and
admins can manage users.

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
