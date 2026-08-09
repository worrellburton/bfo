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
(sign-in, Plaid, QuickBooks) need `vercel dev` or a deployment.

## Environment

Set these in the Vercel project:

| Variable | Used for |
| --- | --- |
| `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` | users, sessions, sign-in codes, Plaid + QuickBooks tokens |
| `BIRD_ACCESS_KEY` | Bird API access key (sent as `Authorization: AccessKey …`) |
| `BIRD_WORKSPACE_ID` | Bird workspace the channels live in |
| `BIRD_SMS_CHANNEL_ID` | *optional* — pins the SMS channel; otherwise the workspace's SMS channel is discovered automatically |
| `BIRD_EMAIL_CHANNEL_ID` | *optional* — same, for email |
| `AUTH_SECRET` | *optional* — pepper mixed into the hash of each one-time code |
| `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV` | brokerage connections on `/investments` |
| `QUICKBOOKS_CLIENT_ID`, `QUICKBOOKS_CLIENT_SECRET` | QuickBooks reports |
| `ANTHROPIC_API_KEY` | agents and document renaming |

### Sign-in

`/login` takes a phone number or an email address, sends a 6-digit code through
Bird, and exchanges it for a 30-day session stored in `app_sessions`. Anyone who
verifies a code lands in `app_users` as `incoming` — an owner or admin approves
them from `/users` before they can get in. Roles are `owner`, `admin`, `member`
and `viewer`; owners and admins can manage users.

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
