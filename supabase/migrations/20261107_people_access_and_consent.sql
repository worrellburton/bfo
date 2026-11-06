-- People and sign-in: who let each person in, when access was turned off or
-- the person removed (Remove now keeps the row and its history instead of
-- deleting it), which version of the Terms each person agreed to, and which
-- text-message disclosure was on screen when a sign-in code was asked for.
--
-- Written by api/auth/users.ts, api/auth/terms.ts and lib/sign-in.ts. Each
-- write leaves these columns out when they aren't there yet, so applying this
-- migration before or after the deploy is safe.
--
-- Additive only: new nullable columns and one index. Nothing existing is
-- changed, renamed or removed.

alter table public.app_users
  add column if not exists added_by uuid references public.app_users(id) on delete set null,
  add column if not exists approved_by uuid references public.app_users(id) on delete set null,
  add column if not exists revoked_at timestamptz,
  add column if not exists revoked_by uuid references public.app_users(id) on delete set null,
  add column if not exists removed_at timestamptz,
  add column if not exists removed_by uuid references public.app_users(id) on delete set null,
  -- The Terms of use this person agreed to (lib/terms.ts TERMS_VERSION), when, and from where.
  add column if not exists terms_version text,
  add column if not exists terms_accepted_at timestamptz,
  add column if not exists terms_accepted_ip text;

comment on column public.app_users.removed_at is 'Removed from People: no access, off the list, history kept. Never purged.';
comment on column public.app_users.terms_version is 'The Terms of use version agreed to with "Agree and continue" (lib/terms.ts).';

-- The text-message disclosure shown when the code was requested (lib/terms.ts SMS_CONSENT_VERSION).
alter table public.login_codes
  add column if not exists consent_version text;

-- The retention purge deletes codes older than 90 days (lib/sign-in.ts purgePaths).
create index if not exists login_codes_created_at_idx on public.login_codes (created_at);
