-- Security: rate limits shared by every server instance, admin two-factor sign-in,
-- and when a password last changed (fresh changes hold automatic payouts).
create table if not exists rate_limits (
  key      text primary key,
  n        integer not null default 0,
  reset_at timestamptz not null
);
create index if not exists rate_limits_reset on rate_limits (reset_at);

alter table users add column if not exists totp_enabled boolean not null default false;
alter table users add column if not exists totp_secret_enc text;
alter table users add column if not exists totp_pending_enc text;
alter table users add column if not exists totp_last_step bigint;
alter table users add column if not exists password_changed_at timestamptz;

alter table sessions add column if not exists mfa_at timestamptz;
create index if not exists sessions_user on sessions (user_id);
