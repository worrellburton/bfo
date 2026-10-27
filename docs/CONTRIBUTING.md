# Contributing

## Branches and pull requests

- `main` is what Vercel deploys. Work on a branch, open a pull request, let
  CI pass (`.github/workflows/ci.yml`: typegen, `tsc --noEmit`, `npm test`,
  `npm run build`), then squash-merge. The history shows one commit per PR
  with the PR number in the title (`Fix the search_path on the database
  functions (#111)`).
- Commit titles are one plain-English sentence about what changed for the
  person using the app, not the mechanism: "Mail's split follows the room it
  has; two render guards", "Investments: say why Connect holdings didn't
  open". A leading area name and colon is common ("Mail:", "Ask BFO:",
  "Home:"). No conventional-commit prefixes.
- The body says why, in a short paragraph or a list, and notes anything done
  outside the repo ("Applied to the project." for a migration).
- Branches made by Claude Code are named `claude/<words>-<id>`; a human branch
  can be anything short.

## Code style

These are observations from the code, not a linter config (there is none).

- TypeScript, `strict` on. Avoid `any` where a type is easy; a few older
  files use it for PostgREST rows. New row types go next to the code that
  reads them.
- Comments explain intent and the reason a thing is the way it is, in full
  sentences. Every function file under `api/` and `lib/` opens with a block
  comment saying what it is for, the HTTP surface (`GET ?view=… → {…}`), who
  may call it, and the env vars it needs. Keep that up when adding one.
- Server code imports with `.js` extensions (`../lib/auth.js`) because the
  Vercel runtime loads ESM. App code imports without.
- Pure logic is split from I/O so it can be tested without a network:
  "The pure pieces are exported on their own" appears across `lib/`.
- Styling is Tailwind v4 (`@import "tailwindcss"` in `app/app.css`, no
  config file). The root font size is 11.9px, so every rem-based Tailwind
  size is 85% of its usual value (`h-11` is 33px). Where a size must be
  exact, write it in px: `h-[44px]` for tap targets. Colours use the glass
  tokens and `dark:` variants already in `app.css`.
- Phone first: layouts are checked at phone width, with safe-area insets;
  hover-only controls must also work on touch.
- Server reads that can exceed 1,000 rows use `fetchAll` from
  `lib/db-pages.ts` with an `order=` on a unique column. Anything time-limited
  that uploads uses `AbortSignal.timeout`.
- Secrets never reach the browser or the logs. Log booleans and shapes, not
  values (`refuseCron` is the model).
- Partners and email-only users are refused by default in `currentUser`;
  opt an endpoint in deliberately and narrow what it returns.

## How to add things

### A page (route)

1. Create `app/routes/<name>.tsx` with a default export component and, if
   needed, `export function meta()`.
2. Add it to `app/routes.ts` inside the `app-layout.tsx` layout (signed-in)
   or `public-layout.tsx` (public). The catch-all `*` must stay last.
3. Run `npm run typecheck`: `react-router typegen` creates the `+types`.
4. Add a nav entry in `app/routes/app-layout.tsx` (`navItems`) and the command
   palette list if people should find it; gate it with `isAdmin` etc. the way
   `/users` and `/phone` are.
5. Fetch with `authFetch` and read the tree with `app/store.ts`.

### An API endpoint

1. Create `api/<name>.ts` (or under `api/<area>/`). Export
   `default async function handler(req: VercelRequest, res: VercelResponse)`.
2. Start with `guard(req, res, ["GET", "POST"])`, then `currentUser(req,
   opts)`, then the role check (`isAdmin`, `canWrite`, `isPartner`), and wrap
   the body in `try { … } catch (err) { return handleError(res, err); }`.
3. Use `fail(res, status, code, message)` for refusals; the client reads
   `error` and `message`.
4. Put reusable logic in `lib/`, pure parts exported. Open the file with the
   block comment described above.
5. If it needs more than 256 MB or 60 s, add it to `functions` in
   `vercel.json`. If it streams, `export const config = {
   supportsResponseStreaming: true }`. If it takes a big body, set
   `config.api.bodyParser.sizeLimit`.
6. Webhooks: verify a signature or shared token first, answer fast, and
   re-read the object from the provider's API rather than trusting the body.

### A migration

1. Add `supabase/migrations/YYYYMMDD_<what>.sql`, opening with a comment that
   says what it is for and why. Make it re-runnable (`if not exists`).
2. Apply it by hand in the Supabase SQL editor or with the Supabase MCP
   (`apply_migration`) before merging the code that depends on it.
3. Update the row types in `lib/`/`api/` and say "Applied to the project" in
   the commit body. There is no automatic migration step.
4. New functions get `set search_path = public` (see
   `20261027_function_search_path.sql`).

### A test

1. Add `tests/<name>.test.ts` (Vitest, `describe`/`it`/`expect`). Test the
   pure exports of `lib/` or `app/` directly.
2. For code that calls `sb()`, mock `../lib/auth.js` with `vi.mock` and route
   paths with regexes, as `tests/tree.test.ts` does. No test may hit a network.
3. `npm test` runs them all; CI runs them on every PR.
