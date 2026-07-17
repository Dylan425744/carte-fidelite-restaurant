-- Comptes commerçants, rôles et isolation multi-établissements.
-- Toutes les lectures/écritures passent par le backend Bravocard (service_role).

create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text not null,
  is_super_admin boolean not null default false,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint user_profiles_email_lowercase_check check (email = lower(email)),
  constraint user_profiles_full_name_check check (char_length(btrim(full_name)) between 2 and 100)
);

create table if not exists public.restaurant_memberships (
  id bigint generated always as identity primary key,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null,
  active boolean not null default true,
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint restaurant_memberships_unique unique (restaurant_id, user_id),
  constraint restaurant_memberships_role_check check (role in ('owner', 'manager', 'employee'))
);

create table if not exists public.access_audit_logs (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  restaurant_id uuid references public.restaurants(id) on delete set null,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone not null default now(),
  constraint access_audit_logs_action_check check (char_length(action) between 2 and 80),
  constraint access_audit_logs_details_check check (jsonb_typeof(details) = 'object')
);

create index if not exists restaurant_memberships_user_active_idx
  on public.restaurant_memberships (user_id, active, restaurant_id);

create index if not exists restaurant_memberships_restaurant_role_idx
  on public.restaurant_memberships (restaurant_id, role, active);

create index if not exists restaurant_memberships_invited_by_idx
  on public.restaurant_memberships (invited_by)
  where invited_by is not null;

create index if not exists access_audit_logs_user_date_idx
  on public.access_audit_logs (user_id, created_at desc);

create index if not exists access_audit_logs_restaurant_date_idx
  on public.access_audit_logs (restaurant_id, created_at desc);

alter table public.user_profiles enable row level security;
alter table public.restaurant_memberships enable row level security;
alter table public.access_audit_logs enable row level security;

revoke all on table public.user_profiles from anon, authenticated;
revoke all on table public.restaurant_memberships from anon, authenticated;
revoke all on table public.access_audit_logs from anon, authenticated;

grant select, insert, update, delete on table public.user_profiles to service_role;
grant select, insert, update, delete on table public.restaurant_memberships to service_role;
grant select, insert, update, delete on table public.access_audit_logs to service_role;
grant usage, select on all sequences in schema public to service_role;
